import { describe, expect, it } from "vitest";
import { DeclarativeHttpAdapter, type HttpExecutor, type ProviderProfile } from "../src/index.js";

const profile: ProviderProfile = {
  id: "declarative-http",
  version: "1.0.0",
  title: "test",
  family: "declarative-http",
  transport: "declarative-http",
  auth: { scheme: "bearer", header: "Authorization", secretRefRequired: true },
  modalities: ["video"],
  features: ["async"],
  async: true,
  supportsCancel: true,
  supportsReconcile: true,
  prompt: { languages: ["zh", "en"], negativePrompt: "field", referenceSyntax: "api-field" },
  notes: []
};

describe("declarative HTTP adapter", () => {
  it("maps submit, poll, cancel and reconcile to one provider contract", async () => {
    const calls: string[] = [];
    const executor: HttpExecutor = {
      async execute(request) {
        calls.push(`${request.method} ${request.url}`);
        if (request.url.endsWith("/cancel")) return { status: 200, headers: {}, body: { status: "cancelled" } };
        if (request.url.includes("/jobs/job-1")) return { status: 200, headers: {}, body: { status: "completed", outputs: [] } };
        return { status: 202, headers: {}, body: { id: "job-1", status: "pending" } };
      }
    };
    const adapter = new DeclarativeHttpAdapter(
      {
        profile,
        secretRef: "secret://test",
        submit: { method: "POST", url: "https://relay.example.com/jobs", body: { prompt: "{{request.prompt}}" }, jobIdPointer: "/id", statusPointer: "/status" },
        poll: { method: "GET", url: "https://relay.example.com/jobs/{{receipt.remoteJobId}}", statusPointer: "/status", outputsPointer: "/outputs" },
        cancel: { method: "POST", url: "https://relay.example.com/jobs/{{receipt.remoteJobId}}/cancel" },
        reconcile: { method: "GET", url: "https://relay.example.com/jobs/{{receipt.remoteJobId}}", statusPointer: "/status", outputsPointer: "/outputs" },
        statusMap: { pending: "queued", completed: "succeeded", failed: "failed", cancelled: "cancelled" }
      },
      executor
    );
    const receipt = await adapter.submit(
      { taskId: "t", modelId: "m", promptRunId: "p", prompt: "hello", media: [], parameters: {} },
      { key: "key", attempt: 1 }
    );
    expect(receipt.remoteJobId).toBe("job-1");
    expect((await adapter.poll(receipt)).state).toBe("succeeded");
    expect((await adapter.cancel(receipt)).state).toBe("cancelled");
    expect((await adapter.reconcile({ receipt, idempotencyKey: "key" })).state).toBe("succeeded");
    expect(calls).toHaveLength(4);
  });

  it("preserves object values for exact declarative placeholders", async () => {
    let submittedBody: unknown;
    const executor: HttpExecutor = {
      async execute(request) {
        submittedBody = request.body;
        return { status: 202, headers: {}, body: { id: "job-object", status: "pending" } };
      }
    };
    const adapter = new DeclarativeHttpAdapter(
      {
        profile,
        submit: { method: "POST", url: "https://relay.example.com/jobs", body: { input: "{{request.parameters.input}}" }, jobIdPointer: "/id" },
        poll: { method: "GET", url: "https://relay.example.com/jobs/{{receipt.remoteJobId}}", statusPointer: "/status" },
        statusMap: { pending: "queued" }
      },
      executor
    );
    await adapter.submit(
      { taskId: "t", modelId: "m", promptRunId: "p", prompt: "hello", media: [], parameters: { input: { prompt: "nested" } } },
      { key: "key", attempt: 1 }
    );
    expect(submittedBody).toEqual({ input: { prompt: "nested" } });
  });
});
