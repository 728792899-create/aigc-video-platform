import { describe, expect, it } from "vitest";
import { OpenAICompatibleAdapter, type HttpExecutor, type ProviderProfile } from "../src/index.js";

const profile: ProviderProfile = {
  id: "openai-compatible",
  version: "1.0.0",
  title: "relay",
  family: "openai-compatible",
  transport: "openai-compatible",
  auth: { scheme: "bearer", header: "Authorization", secretRefRequired: true },
  modalities: ["text"],
  features: ["text", "structured-output"],
  async: false,
  supportsCancel: false,
  supportsReconcile: true,
  prompt: { languages: ["zh", "en"], negativePrompt: "unsupported", referenceSyntax: "api-field" },
  notes: []
};

describe("OpenAI-compatible relay", () => {
  it("normalizes a synchronous completion and deduplicates by idempotency key", async () => {
    let calls = 0;
    const executor: HttpExecutor = {
      async execute(request) {
        calls += 1;
        expect(request.url).toBe("https://relay.example.com/v1/chat/completions");
        expect(request.authRef).toBe("secret://relay");
        return {
          status: 200,
          headers: {},
          body: { id: "chat-1", choices: [{ message: { content: "{\"ok\":true}" } }] }
        };
      }
    };
    const adapter = new OpenAICompatibleAdapter(
      { profile, baseUrl: "https://relay.example.com/v1/", secretRef: "secret://relay" },
      executor
    );
    const request = { taskId: "t", modelId: "m", promptRunId: "p", prompt: "return json", media: [], parameters: {} };
    const first = await adapter.submit(request, { key: "same", attempt: 1 });
    const second = await adapter.submit(request, { key: "same", attempt: 2 });
    expect(first.remoteJobId).toBe("chat-1");
    expect(second.remoteJobId).toBe("chat-1");
    expect(calls).toBe(1);
    expect((await adapter.poll(first)).state).toBe("succeeded");
    expect((await adapter.reconcile({ idempotencyKey: "same" })).matchedBy).toBe("idempotency-key");
  });
});
