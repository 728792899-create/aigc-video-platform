import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { contentHash } from "./hash.js";
import { validationError } from "./errors.js";
import type {
  EvalCase,
  PromptDefinition,
  PromptPackData,
  PromptRef,
  ProviderProfile,
  SkillManifest,
  SkillRef,
  WorkflowDefinition
} from "./types.js";

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function hashWithoutStoredHash<T extends { contentHash?: string }>(value: T): string {
  const { contentHash: _stored, ...rest } = value;
  return contentHash(rest);
}

function keyOf(ref: { id: string; version: string }): string {
  return `${ref.id}@${ref.version}`;
}

export class PromptRegistry {
  readonly prompts: PromptDefinition[];
  readonly skills: SkillManifest[];
  readonly workflows: WorkflowDefinition[];
  readonly providerProfiles: ProviderProfile[];
  readonly evals: EvalCase[];
  private readonly ajv: Ajv2020;
  private readonly variableValidators = new Map<string, ValidateFunction>();
  private readonly outputValidators = new Map<string, ValidateFunction>();

  constructor(data: PromptPackData) {
    this.prompts = data.prompts.map((item) => ({ ...item, contentHash: hashWithoutStoredHash(item) }));
    this.skills = data.skills.map((item) => ({ ...item, contentHash: hashWithoutStoredHash(item) }));
    this.workflows = data.workflows;
    this.providerProfiles = data.providerProfiles;
    this.evals = data.evals;
    this.ajv = new Ajv2020({ allErrors: true, strict: true });
    this.assertIntegrity();
  }

  getPrompt(ref: PromptRef): PromptDefinition {
    const found = this.prompts.find((item) => item.id === ref.id && item.version === ref.version);
    if (!found) throw validationError("PROMPT_VERSION_NOT_FOUND", `Prompt not found: ${keyOf(ref)}`);
    return found;
  }

  getSkill(ref: SkillRef): SkillManifest {
    const found = this.skills.find((item) => item.id === ref.id && item.version === ref.version);
    if (!found) throw validationError("SKILL_VERSION_NOT_FOUND", `Skill not found: ${keyOf(ref)}`);
    return found;
  }

  getProviderProfile(id: string): ProviderProfile {
    const found = this.providerProfiles.find((item) => item.id === id);
    if (!found) throw validationError("PROVIDER_PROFILE_NOT_FOUND", `Provider profile not found: ${id}`);
    return found;
  }

  getWorkflow(id: string, version: string): WorkflowDefinition {
    const found = this.workflows.find((item) => item.id === id && item.version === version);
    if (!found) throw validationError("WORKFLOW_VERSION_NOT_FOUND", `Workflow not found: ${id}@${version}`);
    return found;
  }

  validateVariables(prompt: PromptDefinition, variables: unknown): void {
    const key = keyOf(prompt);
    const validate = this.variableValidators.get(key) ?? this.ajv.compile(prompt.variablesSchema);
    this.variableValidators.set(key, validate);
    if (!validate(variables)) {
      throw validationError("PROMPT_VARIABLES_INVALID", `Variables do not match ${key}`, {
        errors: JSON.parse(JSON.stringify(validate.errors ?? []))
      });
    }
  }

  validateOutput(prompt: PromptDefinition, output: unknown): void {
    const key = keyOf(prompt);
    const validate = this.outputValidators.get(key) ?? this.ajv.compile(prompt.outputSchema);
    this.outputValidators.set(key, validate);
    if (!validate(output)) {
      throw validationError("PROMPT_OUTPUT_INVALID", `Output does not match ${key}`, {
        errors: JSON.parse(JSON.stringify(validate.errors ?? []))
      });
    }
  }

  private assertIntegrity(): void {
    assertUnique(this.prompts.map(keyOf), "prompt");
    assertUnique(this.skills.map(keyOf), "skill");
    assertUnique(this.workflows.map(keyOf), "workflow");
    assertUnique(this.providerProfiles.map((item) => item.id), "provider profile");
    assertUnique(this.evals.map((item) => item.id), "eval case");

    for (const prompt of this.prompts) {
      this.ajv.compile(prompt.variablesSchema);
      this.ajv.compile(prompt.outputSchema);
      if (!prompt.provenance.length || prompt.provenance.some((item) => item.copied !== false)) {
        throw validationError("PROMPT_PROVENANCE_INVALID", `Prompt ${keyOf(prompt)} lacks clean provenance`);
      }
    }
    for (const skill of this.skills) {
      if (skill.trustLevel !== "builtin") {
        throw validationError("BUILTIN_SKILL_TRUST_INVALID", `Bundled skill ${keyOf(skill)} must be builtin`);
      }
      if (!skill.provenance.length || skill.provenance.some((item) => item.copied !== false)) {
        throw validationError("SKILL_PROVENANCE_INVALID", `Skill ${keyOf(skill)} lacks clean provenance`);
      }
    }
    const promptIds = new Set(this.prompts.map((item) => item.id));
    const evalIds = new Set(this.evals.map((item) => item.id));
    for (const prompt of this.prompts) {
      for (const evalId of prompt.evalSuite) {
        if (!evalIds.has(evalId)) {
          throw validationError("PROMPT_EVAL_NOT_FOUND", `${prompt.id} references missing eval ${evalId}`);
        }
      }
    }
    for (const workflow of this.workflows) {
      for (const step of workflow.steps) {
        if (step.promptId && !promptIds.has(step.promptId)) {
          throw validationError("WORKFLOW_PROMPT_NOT_FOUND", `${workflow.id} references missing prompt ${step.promptId}`);
        }
      }
    }
    for (const evalCase of this.evals) {
      if (!promptIds.has(evalCase.promptId)) {
        throw validationError("EVAL_PROMPT_NOT_FOUND", `${evalCase.id} references missing prompt ${evalCase.promptId}`);
      }
    }
  }
}

function assertUnique(values: string[], kind: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw validationError("REGISTRY_DUPLICATE", `Duplicate ${kind}: ${value}`);
    seen.add(value);
  }
}

export async function loadPromptPack(packageRoot: string): Promise<PromptRegistry> {
  const registryRoot = basename(packageRoot) === "registry" ? packageRoot : resolve(packageRoot, "registry");
  const [prompts, skills, workflows, providerProfiles, evals] = await Promise.all([
    loadJson<PromptDefinition[]>(resolve(registryRoot, "prompts.json")),
    loadJson<SkillManifest[]>(resolve(registryRoot, "skills.json")),
    loadJson<WorkflowDefinition[]>(resolve(registryRoot, "workflows.json")),
    loadJson<ProviderProfile[]>(resolve(registryRoot, "provider-profiles.json")),
    loadJson<EvalCase[]>(resolve(registryRoot, "evals.json"))
  ]);
  return new PromptRegistry({ prompts, skills, workflows, providerProfiles, evals });
}
