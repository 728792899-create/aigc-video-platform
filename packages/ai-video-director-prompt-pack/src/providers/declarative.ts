import { validationError } from "../errors.js";
import type {
  CancelObservation,
  IdempotencyContext,
  JsonObject,
  JsonValue,
  ProviderAdapter,
  ProviderObservation,
  ProviderProfile,
  ProviderReceipt,
  ProviderRequest,
  ProviderState,
  ReconcileObservation,
  ReconcileQuery,
  RestrictedHttpRequest
} from "../types.js";
import type { HttpExecutor } from "./http.js";

export interface DeclarativeOperation {
  method: RestrictedHttpRequest["method"];
  url: string;
  headers?: Record<string, string>;
  body?: JsonValue;
}

export interface DeclarativeAdapterConfig {
  profile: ProviderProfile;
  secretRef?: string;
  submit: DeclarativeOperation & {
    jobIdPointer: string;
    statusPointer?: string;
  };
  poll: DeclarativeOperation & {
    statusPointer: string;
    progressPointer?: string;
    outputsPointer?: string;
  };
  cancel?: DeclarativeOperation;
  reconcile?: DeclarativeOperation & {
    statusPointer: string;
    outputsPointer?: string;
  };
  statusMap: Record<string, ProviderState>;
}

export class DeclarativeHttpAdapter implements ProviderAdapter {
  readonly profile: ProviderProfile;

  constructor(
    private readonly config: DeclarativeAdapterConfig,
    private readonly executor: HttpExecutor
  ) {
    this.profile = config.profile;
  }

  async submit(request: ProviderRequest, context: IdempotencyContext): Promise<ProviderReceipt> {
    const response = await this.execute(this.config.submit, { request, context });
    const remoteJobId = pointer(response.body, this.config.submit.jobIdPointer);
    if (typeof remoteJobId !== "string" && typeof remoteJobId !== "number") {
      throw validationError("PROVIDER_RECEIPT_MISSING", "Submit response did not contain a job ID");
    }
    const rawStatus = this.config.submit.statusPointer
      ? pointer(response.body, this.config.submit.statusPointer)
      : undefined;
    return {
      providerId: this.profile.id,
      remoteJobId: String(remoteJobId),
      acceptedAt: new Date().toISOString(),
      ...(rawStatus !== undefined ? { rawStatus: String(rawStatus) } : {})
    };
  }

  async poll(receipt: ProviderReceipt): Promise<ProviderObservation> {
    const response = await this.execute(this.config.poll, { receipt });
    return this.toObservation(response.body, this.config.poll);
  }

  async cancel(receipt: ProviderReceipt): Promise<CancelObservation> {
    if (!this.config.cancel) return { state: "unsupported" };
    await this.execute(this.config.cancel, { receipt });
    return { state: "cancelled" };
  }

  async reconcile(query: ReconcileQuery): Promise<ReconcileObservation> {
    if (!this.config.reconcile) return { state: "outcome_unknown", matchedBy: "not-found" };
    const response = await this.execute(this.config.reconcile, { query, receipt: query.receipt });
    const observation = this.toObservation(response.body, this.config.reconcile);
    return {
      ...observation,
      matchedBy: query.receipt ? "remote-job-id" : "idempotency-key"
    };
  }

  private async execute(operation: DeclarativeOperation, context: Record<string, unknown>) {
    const expanded = expand(operation, context) as unknown as DeclarativeOperation;
    return this.executor.execute({
      method: expanded.method,
      url: expanded.url,
      ...(expanded.headers ? { headers: expanded.headers } : {}),
      ...(expanded.body !== undefined ? { body: expanded.body } : {}),
      ...(this.config.secretRef ? { authRef: this.config.secretRef } : {})
    });
  }

  private toObservation(
    body: JsonValue,
    operation: { statusPointer: string; progressPointer?: string; outputsPointer?: string }
  ): ProviderObservation {
    const rawStatus = String(pointer(body, operation.statusPointer));
    const state = this.config.statusMap[rawStatus] ?? "outcome_unknown";
    const progress = operation.progressPointer ? pointer(body, operation.progressPointer) : undefined;
    const outputs = operation.outputsPointer ? pointer(body, operation.outputsPointer) : undefined;
    const mediaOutputs = Array.isArray(outputs)
      ? (outputs as unknown as NonNullable<ProviderObservation["outputs"]>)
      : undefined;
    return {
      state,
      ...(typeof progress === "number" ? { progress } : {}),
      ...(mediaOutputs !== undefined ? { outputs: mediaOutputs } : {}),
      rawStatus
    };
  }
}

function expand(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$/);
    if (exact?.[1]) {
      const found = getPath(context, exact[1]);
      if (found === undefined) throw validationError("DECLARATIVE_TEMPLATE_MISSING", `Missing value: ${exact[1]}`);
      return found;
    }
    return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path: string) => {
      const found = getPath(context, path);
      if (found === undefined) throw validationError("DECLARATIVE_TEMPLATE_MISSING", `Missing value: ${path}`);
      return typeof found === "string" ? found : JSON.stringify(found);
    });
  }
  if (Array.isArray(value)) return value.map((item) => expand(item, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item, context)]));
  }
  return value;
}

function getPath(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function pointer(root: JsonValue, path: string): JsonValue | undefined {
  if (path === "" || path === "/") return root;
  let current: JsonValue | undefined = root;
  for (const raw of path.split("/").slice(1)) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (current && typeof current === "object") current = current[segment];
    else return undefined;
  }
  return current;
}
