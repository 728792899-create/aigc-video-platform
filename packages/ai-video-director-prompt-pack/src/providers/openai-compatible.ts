import { validationError } from "../errors.js";
import type {
  CancelObservation,
  IdempotencyContext,
  JsonValue,
  ProviderAdapter,
  ProviderObservation,
  ProviderProfile,
  ProviderReceipt,
  ProviderRequest,
  ReconcileObservation,
  ReconcileQuery
} from "../types.js";
import type { HttpExecutor } from "./http.js";

export interface OpenAICompatibleConfig {
  profile: ProviderProfile;
  baseUrl: string;
  secretRef: string;
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly profile: ProviderProfile;
  private readonly completed = new Map<string, JsonValue>();
  private readonly jobsByIdempotency = new Map<string, string>();

  constructor(
    private readonly config: OpenAICompatibleConfig,
    private readonly executor: HttpExecutor
  ) {
    this.profile = config.profile;
  }

  async submit(request: ProviderRequest, context: IdempotencyContext): Promise<ProviderReceipt> {
    const existing = this.jobsByIdempotency.get(context.key);
    if (existing) {
      return { providerId: this.profile.id, remoteJobId: existing, acceptedAt: new Date().toISOString(), rawStatus: "deduplicated" };
    }
    const response = await this.executor.execute({
      method: "POST",
      url: `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
      headers: { "content-type": "application/json", ...(this.config.extraHeaders ?? {}) },
      authRef: this.config.secretRef,
      body: {
        model: request.modelId,
        messages: [
          { role: "system", content: "Return only the JSON required by the supplied prompt." },
          { role: "user", content: request.prompt }
        ],
        ...(typeof request.parameters.temperature === "number"
          ? { temperature: request.parameters.temperature }
          : {}),
        ...(typeof request.parameters.response_format === "object"
          ? { response_format: request.parameters.response_format }
          : {})
      }
    });
    if (response.status < 200 || response.status >= 300) {
      throw validationError("OPENAI_COMPATIBLE_HTTP_ERROR", `Relay returned HTTP ${response.status}`);
    }
    const body = response.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw validationError("OPENAI_COMPATIBLE_RESPONSE_INVALID", "Relay response must be an object");
    }
    const id = typeof body.id === "string" ? body.id : `relay-${context.key}`;
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const first = choices[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) {
      throw validationError("OPENAI_COMPATIBLE_RESPONSE_INVALID", "Relay response has no choices");
    }
    const message = first.message;
    if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.content !== "string") {
      throw validationError("OPENAI_COMPATIBLE_RESPONSE_INVALID", "Relay response has no message content");
    }
    this.completed.set(id, { content: message.content, raw: body });
    this.jobsByIdempotency.set(context.key, id);
    return { providerId: this.profile.id, remoteJobId: id, acceptedAt: new Date().toISOString(), rawStatus: "succeeded" };
  }

  async poll(receipt: ProviderReceipt): Promise<ProviderObservation> {
    const data = this.completed.get(receipt.remoteJobId);
    return data ? { state: "succeeded", progress: 1, data, rawStatus: "succeeded" } : { state: "outcome_unknown" };
  }

  async cancel(receipt: ProviderReceipt): Promise<CancelObservation> {
    return this.completed.has(receipt.remoteJobId) ? { state: "already-terminal" } : { state: "unsupported" };
  }

  async reconcile(query: ReconcileQuery): Promise<ReconcileObservation> {
    const id = query.receipt?.remoteJobId ?? this.jobsByIdempotency.get(query.idempotencyKey);
    if (!id) return { state: "outcome_unknown", matchedBy: "not-found" };
    const data = this.completed.get(id);
    if (!data) return { state: "outcome_unknown", matchedBy: query.receipt ? "remote-job-id" : "idempotency-key" };
    return {
      state: "succeeded",
      progress: 1,
      data,
      rawStatus: "succeeded",
      matchedBy: query.receipt ? "remote-job-id" : "idempotency-key"
    };
  }
}
