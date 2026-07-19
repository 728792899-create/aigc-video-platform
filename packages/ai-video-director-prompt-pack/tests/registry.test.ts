import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPromptPack, NATIVE_PROVIDER_FAMILY_IDS } from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("prompt pack registry", () => {
  it("loads the exact delivery inventory", async () => {
    const registry = await loadPromptPack(packageRoot);
    expect(registry.prompts).toHaveLength(26);
    expect(registry.skills).toHaveLength(31);
    expect(registry.workflows).toHaveLength(2);
    expect(registry.providerProfiles).toHaveLength(13);
    expect(NATIVE_PROVIDER_FAMILY_IDS).toHaveLength(10);
  });

  it("keeps every artifact versioned, hashed and clean-room", async () => {
    const registry = await loadPromptPack(packageRoot);
    for (const prompt of registry.prompts) {
      expect(prompt.version).toBe("1.0.0");
      expect(prompt.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(prompt.provenance.some((item) => item.mode === "original")).toBe(true);
      expect(prompt.provenance.every((item) => item.copied === false)).toBe(true);
      expect(prompt.localeMode).toBe("zh-to-bilingual");
    }
    for (const skill of registry.skills) {
      expect(skill.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(skill.trustLevel).toBe("builtin");
      expect(skill.forbiddenOverrides).toContain("identity-locks");
      expect(skill.forbiddenOverrides).toContain("network-policy");
    }
  });

  it("keeps review gates in both one-click workflows", async () => {
    const registry = await loadPromptPack(packageRoot);
    for (const workflow of registry.workflows) {
      expect(workflow.gates.some((gate) => gate.after === "script" && gate.kind === "human-review")).toBe(true);
      expect(workflow.pauseConditions).toContain("provider-outcome-unknown");
      expect(workflow.pauseConditions).toContain("rights-risk");
    }
  });
});
