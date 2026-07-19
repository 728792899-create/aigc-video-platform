import { validationError } from "./errors.js";
import type { PromptRegistry } from "./registry.js";
import type { EvalJudgment, EvalRunResult, JsonSchema, JsonValue } from "./types.js";

export function createDeterministicSchemaFixture(schema: JsonSchema, seed = "fixture"): JsonValue {
  if ("const" in schema) return schema.const as JsonValue;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0] as JsonValue;
  const type = schema.type;
  if (type === "object" || schema.properties) {
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : Object.keys(properties));
    return Object.fromEntries(
      Object.entries(properties)
        .filter(([key]) => required.has(key))
        .map(([key, child]) => [key, createDeterministicSchemaFixture(child, `${seed}.${key}`)])
    );
  }
  if (type === "array") return [];
  if (type === "number" || type === "integer") return 0;
  if (type === "boolean") return false;
  if (type === "null") return null;
  return seed;
}

export function evaluateCase(
  registry: PromptRegistry,
  caseId: string,
  output: unknown,
  judgments: EvalJudgment[],
  rubricScores: Record<string, number>
): EvalRunResult {
  const evalCase = registry.evals.find((item) => item.id === caseId);
  if (!evalCase) throw validationError("EVAL_CASE_NOT_FOUND", `Eval case not found: ${caseId}`);
  const prompt = registry.prompts.find((item) => item.id === evalCase.promptId);
  if (!prompt) throw validationError("EVAL_PROMPT_NOT_FOUND", `Prompt not found: ${evalCase.promptId}`);
  registry.validateOutput(prompt, output);
  const received = new Map(judgments.map((item) => [item.assertion, item]));
  const normalized = evalCase.hardAssertions.map((assertion) => {
    const result = received.get(assertion);
    if (!result) return { assertion, passed: false, evidence: "missing judgment" };
    return result;
  });
  const hardAssertionsPassed = normalized.every((item) => item.passed);
  return {
    caseId,
    schemaPassed: true,
    hardAssertionsPassed,
    judgments: normalized,
    rubricScores,
    releaseBlocked: !hardAssertionsPassed
  };
}
