import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { securityError, validationError } from "../errors.js";
import type { RestrictedHttpRequest, RestrictedHttpResponse } from "../types.js";

export interface HttpExecutionPolicy {
  allowedHosts: string[];
  allowHttp?: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
  secretResolver?: (secretRef: string) => Promise<string>;
  authHeader?: string;
}

export interface HttpExecutor {
  execute(request: RestrictedHttpRequest): Promise<RestrictedHttpResponse>;
}

export function createSafeJsonHttpExecutor(policy: HttpExecutionPolicy): HttpExecutor {
  return {
    execute: (request) => executeJsonRequest(request, policy, 0)
  };
}

async function executeJsonRequest(
  input: RestrictedHttpRequest,
  policy: HttpExecutionPolicy,
  redirectCount: number
): Promise<RestrictedHttpResponse> {
  const target = new URL(input.url);
  if (target.protocol !== "https:" && !(policy.allowHttp && target.protocol === "http:")) {
    throw securityError("EGRESS_PROTOCOL_BLOCKED", `Blocked protocol: ${target.protocol}`);
  }
  if (!policy.allowedHosts.includes(target.hostname)) {
    throw securityError("EGRESS_HOST_BLOCKED", `Blocked host: ${target.hostname}`);
  }
  const addresses = await resolvePublicAddresses(target.hostname);
  const selected = addresses[0];
  if (!selected) throw securityError("EGRESS_DNS_EMPTY", `No public address for ${target.hostname}`);

  const headers: Record<string, string> = { accept: "application/json", ...(input.headers ?? {}) };
  if (input.authRef) {
    if (!policy.secretResolver) throw securityError("SECRET_RESOLVER_MISSING", "No secret resolver configured");
    headers[policy.authHeader ?? "authorization"] = `Bearer ${await policy.secretResolver(input.authRef)}`;
  }
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  if (body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["content-type"] = "application/json";
  }
  if (body !== undefined) headers["content-length"] = String(Buffer.byteLength(body));

  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
  const response = await new Promise<{ status: number; headers: Record<string, string>; data: Buffer }>(
    (resolvePromise, reject) => {
      const req = transport(
        target,
        {
          method: input.method,
          headers,
          timeout: policy.timeoutMs,
          lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family)
        },
        (res) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > policy.maxResponseBytes) {
              req.destroy(securityError("EGRESS_RESPONSE_TOO_LARGE", "Response exceeded byte limit"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            const normalized: Record<string, string> = {};
            for (const [key, value] of Object.entries(res.headers)) {
              if (value !== undefined) normalized[key] = Array.isArray(value) ? value.join(",") : value;
            }
            resolvePromise({
              status: res.statusCode ?? 0,
              headers: normalized,
              data: Buffer.concat(chunks)
            });
          });
        }
      );
      req.on("timeout", () => req.destroy(new Error("HTTP_TIMEOUT")));
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    }
  );

  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
    if (redirectCount >= policy.maxRedirects) {
      throw securityError("EGRESS_REDIRECT_LIMIT", "Too many redirects");
    }
    const redirect = new URL(response.headers.location, target);
    const sameHost = redirect.hostname === target.hostname;
    const nextHeaders = { ...(input.headers ?? {}) };
    if (!sameHost) {
      for (const key of Object.keys(nextHeaders)) {
        if (["authorization", "x-api-key", "api-key"].includes(key.toLowerCase())) delete nextHeaders[key];
      }
    }
    const redirected: RestrictedHttpRequest = {
      method: response.status === 303 ? "GET" : input.method,
      url: redirect.toString(),
      headers: nextHeaders,
      ...(input.authRef && sameHost ? { authRef: input.authRef } : {}),
      ...(response.status !== 303 && input.body !== undefined ? { body: input.body } : {})
    };
    return executeJsonRequest(redirected, policy, redirectCount + 1);
  }

  const text = response.data.toString("utf8");
  let parsed: unknown = null;
  if (text.length) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw validationError("HTTP_RESPONSE_NOT_JSON", "Provider returned non-JSON response", {
        status: response.status
      });
    }
  }
  return { status: response.status, headers: response.headers, body: parsed as RestrictedHttpResponse["body"] };
}

async function resolvePublicAddresses(hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>> {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw securityError("SSRF_PRIVATE_ADDRESS", `Blocked address: ${hostname}`);
    return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  }
  const resolved = await lookup(hostname, { all: true, verbatim: true });
  for (const item of resolved) {
    if (isPrivateAddress(item.address)) {
      throw securityError("SSRF_PRIVATE_ADDRESS", `Host resolved to blocked address: ${item.address}`);
    }
  }
  return resolved.map((item) => ({ address: item.address, family: item.family as 4 | 6 }));
}

export function isPrivateAddress(address: string): boolean {
  if (address === "::" || address === "::1") return true;
  const lower = address.toLowerCase();
  if (
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff") ||
    lower.startsWith("2001:db8")
  ) return true;
  if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a = 0, b = 0] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && parts[2] === 0) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && parts[2] === 2) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && parts[2] === 100) ||
      (a === 203 && b === 0 && parts[2] === 113) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  return false;
}
