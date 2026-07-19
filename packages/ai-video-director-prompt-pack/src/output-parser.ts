import { DomainError, validationError } from "./errors.js";
import type { PromptRegistry } from "./registry.js";
import type { JsonObject, PromptRef } from "./types.js";

export function parsePromptOutput(
  registry: PromptRegistry,
  promptRef: PromptRef,
  raw: string,
  options: { echoNeedle?: string; invariantFailures?: string[] } = {}
): JsonObject {
  const prompt = registry.getPrompt(promptRef);
  if (options.echoNeedle && raw.includes(options.echoNeedle)) {
    throw new DomainError({
      code: "MODEL_ECHO",
      category: "provider_rejected",
      message: "Model echoed protected prompt content",
      retryable: false,
      outcomeCertainty: "certain"
    });
  }
  const normalized = stripSingleFence(raw.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new DomainError({
      code: "MODEL_FORMAT_JSON_PARSE",
      category: "provider_rejected",
      message: "Model output is not valid JSON",
      retryable: true,
      outcomeCertainty: "certain"
    });
  }
  try {
    registry.validateOutput(prompt, parsed);
  } catch (error) {
    if (error instanceof DomainError) {
      throw new DomainError({
        code: "MODEL_FORMAT_MISSING_KEYS",
        category: "provider_rejected",
        message: "Model output does not satisfy the required schema",
        retryable: true,
        outcomeCertainty: "certain",
        details: { sourceCode: error.code }
      });
    }
    throw error;
  }
  if (options.invariantFailures?.length) {
    throw new DomainError({
      code: "MODEL_SEMANTIC_DRIFT",
      category: "provider_rejected",
      message: "Model output changed locked facts or continuity",
      retryable: false,
      outcomeCertainty: "certain",
      details: { invariantFailures: options.invariantFailures }
    });
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw validationError("MODEL_OUTPUT_NOT_OBJECT", "Model output must be an object");
  }
  return parsed as JsonObject;
}

function stripSingleFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? value;
}
