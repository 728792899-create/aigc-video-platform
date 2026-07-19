import { contentHash } from "./hash.js";
import { securityError, validationError } from "./errors.js";
import type { PromptRegistry } from "./registry.js";
import type { SkillManifest, SkillRef } from "./types.js";

export interface SkillActivationContext {
  stage: string;
  promptId: string;
  allowTrustLevels?: Array<SkillManifest["trustLevel"]>;
}

export interface SkillPolicyPatch {
  skill: SkillRef & { contentHash: string };
  instructions: string[];
  rubric: string[];
  preferredModules: string[];
}

export function activateSkill(
  registry: PromptRegistry,
  ref: SkillRef,
  context: SkillActivationContext
): SkillPolicyPatch {
  const skill = registry.getSkill(ref);
  const allowed = context.allowTrustLevels ?? ["builtin", "reviewed", "project"];
  if (!allowed.includes(skill.trustLevel)) {
    throw securityError("SKILL_TRUST_REJECTED", `Skill trust level is not allowed: ${skill.trustLevel}`);
  }
  if (!skill.stages.includes("*") && !skill.stages.includes(context.stage)) {
    throw validationError("SKILL_STAGE_INCOMPATIBLE", `${skill.id} is not compatible with ${context.stage}`);
  }
  if (
    !skill.compatiblePromptIds.includes("*") &&
    !skill.compatiblePromptIds.includes(context.promptId)
  ) {
    throw validationError("SKILL_PROMPT_INCOMPATIBLE", `${skill.id} is not compatible with ${context.promptId}`);
  }
  return {
    skill: { id: skill.id, version: skill.version, contentHash: skill.contentHash ?? contentHash(skill) },
    instructions: [...skill.policyPatch.instructions],
    rubric: [...skill.policyPatch.rubric],
    preferredModules: [...skill.policyPatch.preferredModules]
  };
}

export function assertNoSkillConflict(patches: SkillPolicyPatch[]): void {
  const primaryFamilies = new Map<string, string>();
  for (const patch of patches) {
    const family = patch.skill.id.split(".").slice(0, 2).join(".");
    if (family !== "story.genre" && family !== "art.style") continue;
    const previous = primaryFamilies.get(family);
    if (previous && previous !== patch.skill.id) {
      throw validationError("SKILL_CONFLICT", `Only one primary ${family} skill may be active`, {
        first: previous,
        second: patch.skill.id
      });
    }
    primaryFamilies.set(family, patch.skill.id);
  }
}
