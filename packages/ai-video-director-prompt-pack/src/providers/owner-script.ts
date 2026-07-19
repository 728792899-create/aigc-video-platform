import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { securityError, validationError } from "../errors.js";
import type {
  CancelObservation,
  IdempotencyContext,
  JsonObject,
  JsonValue,
  OwnerScriptManifest,
  ProviderAdapter,
  ProviderObservation,
  ProviderProfile,
  ProviderReceipt,
  ProviderRequest,
  ReconcileObservation,
  ReconcileQuery,
  RestrictedHttpRequest,
  RestrictedHttpResponse
} from "../types.js";
import type { HttpExecutor } from "./http.js";

const ALLOWED_OPERATIONS = [
  "buildSubmit",
  "parseSubmit",
  "buildPoll",
  "parsePoll",
  "buildCancel",
  "parseCancel",
  "buildReconcile",
  "parseReconcile"
] as const;

type OwnerOperation = (typeof ALLOWED_OPERATIONS)[number];

const RUNNER = String.raw`
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const [modulePath, operation] = process.argv.slice(1);
if (!modulePath || !operation) throw new Error("OWNER_SCRIPT_ARGUMENTS_MISSING");
let input = "";
for await (const chunk of process.stdin) input += chunk;
const payload = JSON.parse(input || "null");
const source = await readFile(modulePath, "utf8");
const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
const loaded = new vm.SourceTextModule(source, { context, identifier: modulePath });
await loaded.link(() => { throw new Error("OWNER_SCRIPT_IMPORT_BLOCKED"); });
await loaded.evaluate();
const adapter = loaded.namespace.default ?? loaded.namespace.adapter;
const fn = adapter[operation];
if (typeof fn !== "function") throw new Error("OWNER_SCRIPT_OPERATION_MISSING:" + operation);
const output = await fn(payload);
process.stdout.write(JSON.stringify(output));
`;

export class OwnerScriptBridge {
  private verifiedPath?: string;

  constructor(
    private readonly packageRoot: string,
    readonly manifest: OwnerScriptManifest
  ) {
    if (!manifest.trustedOwnerOnly) {
      throw securityError("OWNER_SCRIPT_TRUST_REQUIRED", "Owner scripts must be explicitly owner-trusted");
    }
  }

  async verify(): Promise<string> {
    const root = await realpath(this.packageRoot);
    const target = await realpath(resolve(root, this.manifest.entry));
    if (target !== root && !target.startsWith(`${root}/`)) {
      throw securityError("OWNER_SCRIPT_PATH_ESCAPE", "Owner script is outside the approved package root");
    }
    const digest = createHash("sha256").update(await readFile(target)).digest("hex");
    if (digest !== this.manifest.sha256) {
      throw securityError("OWNER_SCRIPT_HASH_MISMATCH", "Owner script hash does not match manifest");
    }
    this.verifiedPath = target;
    return target;
  }

  async invoke(operation: OwnerOperation, payload: JsonValue): Promise<JsonValue> {
    if (!ALLOWED_OPERATIONS.includes(operation)) {
      throw securityError("OWNER_SCRIPT_OPERATION_BLOCKED", `Blocked operation: ${operation}`);
    }
    const target = this.verifiedPath ?? (await this.verify());
    return new Promise<JsonValue>((resolvePromise, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--permission",
          `--allow-fs-read=${target}`,
          "--max-old-space-size=64",
          "--experimental-vm-modules",
          "--input-type=module",
          "--eval",
          RUNNER,
          target,
          operation
        ],
        {
          cwd: this.packageRoot,
          env: {},
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"]
        }
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        if (!settled) {
          settled = true;
          reject(securityError("OWNER_SCRIPT_TIMEOUT", "Owner script exceeded its time limit"));
        }
      }, this.manifest.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > this.manifest.maxOutputBytes) {
          child.kill("SIGKILL");
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(securityError("OWNER_SCRIPT_OUTPUT_TOO_LARGE", "Owner script exceeded output limit"));
          }
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (Buffer.concat(stderr).length < 4096) stderr.push(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code !== 0) {
          reject(
            validationError("OWNER_SCRIPT_FAILED", "Owner script process failed", {
              exitCode: code ?? -1,
              stderr: Buffer.concat(stderr).toString("utf8").slice(0, 2048)
            })
          );
          return;
        }
        try {
          resolvePromise(JSON.parse(Buffer.concat(stdout).toString("utf8")) as JsonValue);
        } catch {
          reject(validationError("OWNER_SCRIPT_OUTPUT_INVALID", "Owner script did not return valid JSON"));
        }
      });
      child.stdin.end(JSON.stringify(payload));
    });
  }
}

export class OwnerScriptProviderAdapter implements ProviderAdapter {
  readonly profile: ProviderProfile;

  constructor(
    profile: ProviderProfile,
    private readonly bridge: OwnerScriptBridge,
    private readonly executor: HttpExecutor
  ) {
    this.profile = profile;
  }

  async submit(request: ProviderRequest, context: IdempotencyContext): Promise<ProviderReceipt> {
    const built = await this.bridge.invoke("buildSubmit", toJson({ request, context }));
    const response = await this.executor.execute(assertOwnerRequest(assertHttpRequest(built), this.bridge.manifest));
    const parsed = await this.bridge.invoke("parseSubmit", toJson(response));
    return assertReceipt(parsed, this.profile.id);
  }

  async poll(receipt: ProviderReceipt): Promise<ProviderObservation> {
    const built = await this.bridge.invoke("buildPoll", toJson(receipt));
    const response = await this.executor.execute(assertOwnerRequest(assertHttpRequest(built), this.bridge.manifest));
    return assertObservation(await this.bridge.invoke("parsePoll", toJson(response)));
  }

  async cancel(receipt: ProviderReceipt): Promise<CancelObservation> {
    const built = await this.bridge.invoke("buildCancel", toJson(receipt));
    const response = await this.executor.execute(assertOwnerRequest(assertHttpRequest(built), this.bridge.manifest));
    return (await this.bridge.invoke("parseCancel", toJson(response))) as unknown as CancelObservation;
  }

  async reconcile(query: ReconcileQuery): Promise<ReconcileObservation> {
    const built = await this.bridge.invoke("buildReconcile", toJson(query));
    const response = await this.executor.execute(assertOwnerRequest(assertHttpRequest(built), this.bridge.manifest));
    return (await this.bridge.invoke("parseReconcile", toJson(response))) as unknown as ReconcileObservation;
  }
}

function assertHttpRequest(value: JsonValue): RestrictedHttpRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("OWNER_SCRIPT_REQUEST_INVALID", "Owner script request must be an object");
  }
  const request = value as JsonObject;
  if (typeof request.method !== "string" || typeof request.url !== "string") {
    throw validationError("OWNER_SCRIPT_REQUEST_INVALID", "Owner script request requires method and url");
  }
  return request as unknown as RestrictedHttpRequest;
}

function assertReceipt(value: JsonValue, providerId: string): ProviderReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("OWNER_SCRIPT_RECEIPT_INVALID", "Receipt must be an object");
  }
  const item = value as JsonObject;
  if (typeof item.remoteJobId !== "string") {
    throw validationError("OWNER_SCRIPT_RECEIPT_INVALID", "Receipt requires remoteJobId");
  }
  return {
    providerId,
    remoteJobId: item.remoteJobId,
    acceptedAt: typeof item.acceptedAt === "string" ? item.acceptedAt : new Date().toISOString(),
    ...(typeof item.rawStatus === "string" ? { rawStatus: item.rawStatus } : {})
  };
}

function assertOwnerRequest(
  request: RestrictedHttpRequest,
  manifest: OwnerScriptManifest
): RestrictedHttpRequest {
  const host = new URL(request.url).hostname;
  if (!manifest.allowedHosts.includes(host)) {
    throw securityError("OWNER_SCRIPT_HOST_BLOCKED", `Owner script requested undeclared host: ${host}`);
  }
  if (request.authRef && !manifest.secretRefs.includes(request.authRef)) {
    throw securityError("OWNER_SCRIPT_SECRET_BLOCKED", "Owner script requested undeclared secret reference");
  }
  return request;
}

function assertObservation(value: JsonValue): ProviderObservation {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.state !== "string") {
    throw validationError("OWNER_SCRIPT_OBSERVATION_INVALID", "Observation requires state");
  }
  return value as unknown as ProviderObservation;
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
