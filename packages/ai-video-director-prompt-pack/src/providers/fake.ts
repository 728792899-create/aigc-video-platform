import { createHash } from "node:crypto";
import type {
  CancelObservation,
  IdempotencyContext,
  MediaRef,
  ProviderAdapter,
  ProviderObservation,
  ProviderProfile,
  ProviderReceipt,
  ProviderRequest,
  ReconcileObservation,
  ReconcileQuery
} from "../types.js";

export interface FakeScenario {
  id: string;
  submit: "accept" | "reject" | "timeout-before-receipt" | "timeout-after-accept";
  observations: Array<{
    afterPoll: number;
    state: ProviderObservation["state"];
    progress?: number;
    outputs?: MediaRef[];
  }>;
  cancel: CancelObservation["state"];
  reconcile: ReconcileObservation["state"];
  latencyMs?: number;
}

export class FakeProviderAdapter implements ProviderAdapter {
  readonly profile: ProviderProfile;
  private readonly polls = new Map<string, number>();
  private readonly jobsByIdempotency = new Map<string, string>();

  constructor(profile: ProviderProfile, private readonly scenario: FakeScenario) {
    this.profile = profile;
  }

  async submit(request: ProviderRequest, context: IdempotencyContext): Promise<ProviderReceipt> {
    await delay(this.scenario.latencyMs ?? 0);
    if (this.scenario.submit === "reject") throw new Error("FAKE_PROVIDER_REJECTED");
    const existing = this.jobsByIdempotency.get(context.key);
    const remoteJobId = existing ?? deterministicId(`${this.scenario.id}:${context.key}:${request.taskId}`);
    this.jobsByIdempotency.set(context.key, remoteJobId);
    if (this.scenario.submit === "timeout-before-receipt") throw new Error("FAKE_SUBMIT_TIMEOUT_BEFORE_RECEIPT");
    if (this.scenario.submit === "timeout-after-accept") throw new Error("FAKE_SUBMIT_TIMEOUT_AFTER_ACCEPT");
    return {
      providerId: this.profile.id,
      remoteJobId,
      acceptedAt: new Date(0).toISOString(),
      rawStatus: "accepted"
    };
  }

  async poll(receipt: ProviderReceipt): Promise<ProviderObservation> {
    await delay(this.scenario.latencyMs ?? 0);
    const count = (this.polls.get(receipt.remoteJobId) ?? 0) + 1;
    this.polls.set(receipt.remoteJobId, count);
    const eligible = this.scenario.observations
      .filter((item) => item.afterPoll <= count)
      .sort((a, b) => b.afterPoll - a.afterPoll)[0];
    if (!eligible) return { state: "queued", progress: 0, rawStatus: "fake-queued" };
    return {
      state: eligible.state,
      ...(eligible.progress !== undefined ? { progress: eligible.progress } : {}),
      ...(eligible.outputs ? { outputs: eligible.outputs } : {}),
      rawStatus: `fake-${eligible.state}`
    };
  }

  async cancel(_receipt: ProviderReceipt): Promise<CancelObservation> {
    await delay(this.scenario.latencyMs ?? 0);
    return { state: this.scenario.cancel, detail: `scenario:${this.scenario.id}` };
  }

  async reconcile(query: ReconcileQuery): Promise<ReconcileObservation> {
    await delay(this.scenario.latencyMs ?? 0);
    const remoteJobId = query.receipt?.remoteJobId ?? this.jobsByIdempotency.get(query.idempotencyKey);
    if (!remoteJobId) return { state: "outcome_unknown", matchedBy: "not-found" };
    if (this.scenario.reconcile === "succeeded") {
      const final = this.scenario.observations.find((item) => item.state === "succeeded");
      return {
        state: "succeeded",
        ...(final?.outputs ? { outputs: final.outputs } : {}),
        matchedBy: query.receipt ? "remote-job-id" : "idempotency-key"
      };
    }
    return {
      state: this.scenario.reconcile,
      matchedBy: query.receipt ? "remote-job-id" : "idempotency-key"
    };
  }
}

function deterministicId(input: string): string {
  return `fake_${createHash("sha256").update(input).digest("hex").slice(0, 20)}`;
}

async function delay(ms: number): Promise<void> {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}
