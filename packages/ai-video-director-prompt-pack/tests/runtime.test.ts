import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FakeProviderAdapter,
  isPrivateAddress,
  loadPromptPack,
  ModelCatalog,
  OwnerScriptBridge,
  OwnerScriptProviderAdapter,
  PromptVersionStore,
  type ModelCapability,
  type OwnerScriptManifest
} from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("runtime building blocks", () => {
  it("selects by capability and records downgrade", async () => {
    const registry = await loadPromptPack(packageRoot);
    const models: ModelCapability[] = [
      { modelId: "video-a", providerId: "minimax", modalities: ["video"], features: ["first-frame"], limits: {}, enabled: true, snapshotVersion: "1" },
      { modelId: "video-b", providerId: "google-gemini", modalities: ["video"], features: ["first-frame", "last-frame"], limits: {}, enabled: true, snapshotVersion: "1" }
    ];
    const selected = new ModelCatalog(models, registry.providerProfiles).resolve(
      { modalities: ["video"], features: ["first-frame", "last-frame"] },
      { allowCapabilityDowngrade: false }
    );
    expect(selected.model.modelId).toBe("video-b");
    expect(selected.downgradedFeatures).toEqual([]);
  });

  it("uses append-only alias history and exact versions", () => {
    const store = new PromptVersionStore();
    store.publish("intent.active", "intent.normalize@1.0.0", "initial", "tester");
    store.publish("intent.active", "intent.normalize@1.1.0", "canary passed", "tester");
    store.rollback("intent.active", 0, "regression", "tester");
    expect(store.resolveAlias("intent.active")).toBe("intent.normalize@1.0.0");
    expect(store.listHistory("intent.active")).toHaveLength(3);
  });

  it("reconciles a fake timeout-after-accept without resubmitting", async () => {
    const registry = await loadPromptPack(packageRoot);
    const adapter = new FakeProviderAdapter(registry.getProviderProfile("minimax"), {
      id: "unknown-result",
      submit: "timeout-after-accept",
      observations: [{ afterPoll: 1, state: "succeeded", outputs: [] }],
      cancel: "cancelled",
      reconcile: "succeeded"
    });
    await expect(
      adapter.submit(
        { taskId: "t1", modelId: "m1", promptRunId: "p1", prompt: "x", media: [], parameters: {} },
        { key: "same-key", attempt: 1 }
      )
    ).rejects.toThrow(/TIMEOUT_AFTER_ACCEPT/);
    const reconciled = await adapter.reconcile({ idempotencyKey: "same-key" });
    expect(reconciled.state).toBe("succeeded");
    expect(reconciled.matchedBy).toBe("idempotency-key");
  });

  it("blocks private, loopback, link-local and mapped addresses", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("::ffff:192.168.1.1")).toBe(true);
    expect(isPrivateAddress("2001:db8::1")).toBe(true);
    expect(isPrivateAddress("192.0.2.1")).toBe(true);
    expect(isPrivateAddress("198.51.100.3")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });

  it("runs owner transforms with empty env, no direct network and no arbitrary file reads", async () => {
    const root = resolve(packageRoot, "tests/fixtures");
    const entry = "restricted-check.mjs";
    const hash = createHash("sha256").update(await readFile(resolve(root, entry))).digest("hex");
    const manifest: OwnerScriptManifest = {
      id: "restricted-check",
      version: "1.0.0",
      entry,
      sha256: hash,
      allowedHosts: ["relay.example.com"],
      capabilities: ["text"],
      secretRefs: [],
      timeoutMs: 2000,
      maxOutputBytes: 100000,
      trustedOwnerOnly: true
    };
    const output = await new OwnerScriptBridge(root, manifest).invoke("buildSubmit", {});
    const body = (output as { body: Record<string, boolean> }).body;
    expect(body.environmentIsEmpty).toBe(true);
    expect(body.fileBlocked).toBe(true);
    expect(body.networkBlocked).toBe(true);
  });

  it("rejects owner script hash mismatch and timeout", async () => {
    const root = resolve(packageRoot, "tests/fixtures");
    const bad: OwnerScriptManifest = {
      id: "bad",
      version: "1.0.0",
      entry: "restricted-check.mjs",
      sha256: "0".repeat(64),
      allowedHosts: [],
      capabilities: [],
      secretRefs: [],
      timeoutMs: 100,
      maxOutputBytes: 100,
      trustedOwnerOnly: true
    };
    await expect(new OwnerScriptBridge(root, bad).verify()).rejects.toThrow(/hash/i);

    const entry = "timeout.mjs";
    const hash = createHash("sha256").update(await readFile(resolve(root, entry))).digest("hex");
    const timed = { ...bad, id: "timeout", entry, sha256: hash, timeoutMs: 50, maxOutputBytes: 1000 };
    await expect(new OwnerScriptBridge(root, timed).invoke("buildSubmit", {})).rejects.toThrow(/time limit/i);
  });

  it("verifies the shipped owner example and rejects undeclared host or secret use", async () => {
    const examples = resolve(packageRoot, "examples");
    const shipped = JSON.parse(await readFile(resolve(examples, "owner-relay-manifest.json"), "utf8")) as OwnerScriptManifest;
    await expect(new OwnerScriptBridge(examples, shipped).verify()).resolves.toBe(
      resolve(examples, "owner-relay-adapter.mjs")
    );

    const fixtures = resolve(packageRoot, "tests/fixtures");
    const entry = "bad-policy.mjs";
    const sha256 = createHash("sha256").update(await readFile(resolve(fixtures, entry))).digest("hex");
    const baseManifest: OwnerScriptManifest = {
      id: "bad-policy",
      version: "1.0.0",
      entry,
      sha256,
      allowedHosts: [],
      capabilities: ["text"],
      secretRefs: [],
      timeoutMs: 1000,
      maxOutputBytes: 10000,
      trustedOwnerOnly: true
    };
    const registry = await loadPromptPack(packageRoot);
    const executor = { execute: async () => ({ status: 200, headers: {}, body: {} as const }) };
    const request = { taskId: "t", modelId: "m", promptRunId: "p", prompt: "x", media: [], parameters: {} };
    await expect(
      new OwnerScriptProviderAdapter(
        registry.getProviderProfile("owner-script"),
        new OwnerScriptBridge(fixtures, baseManifest),
        executor
      ).submit(request, { key: "k", attempt: 1 })
    ).rejects.toThrow(/undeclared host/i);

    const secretManifest = { ...baseManifest, allowedHosts: ["evil.example"] };
    await expect(
      new OwnerScriptProviderAdapter(
        registry.getProviderProfile("owner-script"),
        new OwnerScriptBridge(fixtures, secretManifest),
        executor
      ).submit(request, { key: "k", attempt: 1 })
    ).rejects.toThrow(/secret/i);
  });
});
