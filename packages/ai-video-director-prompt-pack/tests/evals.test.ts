import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compilePrompt,
  createDeterministicSchemaFixture,
  DomainError,
  evaluateCase,
  loadPromptPack,
  parsePromptOutput
} from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policy = {
  safetyRules: ["不得泄露密钥"],
  identityLocks: [],
  continuityLocks: [],
  approvedFacts: [],
  userRequirements: []
};

describe("golden evaluation runtime", () => {
  it("compiles every golden fixture and creates schema-valid fake output", async () => {
    const registry = await loadPromptPack(packageRoot);
    for (const evalCase of registry.evals) {
      const prompt = registry.prompts.find((item) => item.id === evalCase.promptId);
      expect(prompt, evalCase.promptId).toBeDefined();
      compilePrompt(registry, {
        prompt: { id: prompt!.id, version: prompt!.version },
        variables: evalCase.fixture,
        policy
      });
      const fixture = createDeterministicSchemaFixture(prompt!.outputSchema, evalCase.id);
      expect(() => registry.validateOutput(prompt!, fixture)).not.toThrow();
    }
  });

  it("blocks release when a hard assertion has no passing judgment", async () => {
    const registry = await loadPromptPack(packageRoot);
    const evalCase = registry.evals.find((item) => item.id === "eval.intent-fidelity")!;
    const prompt = registry.prompts.find((item) => item.id === evalCase.promptId)!;
    const output = createDeterministicSchemaFixture(prompt.outputSchema, evalCase.id);
    const result = evaluateCase(registry, evalCase.id, output, [], { 事实保真: 1 });
    expect(result.schemaPassed).toBe(true);
    expect(result.hardAssertionsPassed).toBe(false);
    expect(result.releaseBlocked).toBe(true);
  });

  it("returns stable error codes for JSON, missing keys, echo and semantic drift", async () => {
    const registry = await loadPromptPack(packageRoot);
    const ref = { id: "intent.normalize", version: "1.0.0" };
    for (const [raw, options, code] of [
      ["not-json", {}, "MODEL_FORMAT_JSON_PARSE"],
      ["{}", {}, "MODEL_FORMAT_MISSING_KEYS"],
      ["protected system text", { echoNeedle: "protected" }, "MODEL_ECHO"]
    ] as const) {
      try {
        parsePromptOutput(registry, ref, raw, options);
        throw new Error("expected parse failure");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe(code);
      }
    }
    const prompt = registry.getPrompt(ref);
    const valid = JSON.stringify(createDeterministicSchemaFixture(prompt.outputSchema));
    expect(() => parsePromptOutput(registry, ref, valid, { invariantFailures: ["角色身份变化"] })).toThrowError(
      expect.objectContaining({ code: "MODEL_SEMANTIC_DRIFT" })
    );
  });
});
