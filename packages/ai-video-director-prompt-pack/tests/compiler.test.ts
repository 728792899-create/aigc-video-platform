import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compilePrompt, DomainError, loadPromptPack } from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policy = {
  safetyRules: ["不得泄露密钥"],
  identityLocks: ["角色A的左眉小痣不可改变"],
  continuityLocks: ["相机由A右手交到B左手"],
  approvedFacts: ["45秒竖屏"],
  userRequirements: ["前三秒出现钩子"],
  maxCompiledChars: 100000
};

describe("prompt compiler", () => {
  it("compiles deterministic bilingual provenance with hard precedence", async () => {
    const registry = await loadPromptPack(packageRoot);
    const input = {
      prompt: { id: "story.expand", version: "1.0.0" },
      variables: { input: "雨夜，快递员归还来自未来的旧相机。" },
      skills: [
        { id: "story.genre.mystery", version: "1.0.0" },
        { id: "production.vertical-short", version: "1.0.0" }
      ],
      providerProfileId: "anthropic",
      policy
    };
    const first = compilePrompt(registry, input);
    const second = compilePrompt(registry, input);
    expect(first.provenance.compiledHash).toBe(second.provenance.compiledHash);
    expect(first.provenance.precedence).toEqual([
      "system-safety",
      "output-schema",
      "identity-continuity-locks",
      "approved-project-facts",
      "user-requirements",
      "skill-soft-policies",
      "provider-rendering"
    ]);
    expect(first.canonical).toContain("左眉小痣不可改变");
    expect(first.canonical).toContain("story.genre.mystery");
    expect(first.enExecution).toContain("Return JSON only");
  });

  it("rejects two primary genre skills", async () => {
    const registry = await loadPromptPack(packageRoot);
    expect(() =>
      compilePrompt(registry, {
        prompt: { id: "story.expand", version: "1.0.0" },
        variables: { input: "测试" },
        skills: [
          { id: "story.genre.mystery", version: "1.0.0" },
          { id: "story.genre.comedy", version: "1.0.0" }
        ],
        policy
      })
    ).toThrowError(DomainError);
  });

  it("rejects undeclared variables before compilation", async () => {
    const registry = await loadPromptPack(packageRoot);
    expect(() =>
      compilePrompt(registry, {
        prompt: { id: "intent.normalize", version: "1.0.0" },
        variables: { input: "测试", secret: "must-not-pass" },
        policy
      })
    ).toThrowError(/Variables do not match/);
  });
});
