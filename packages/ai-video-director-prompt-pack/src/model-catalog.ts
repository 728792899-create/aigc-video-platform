import { validationError } from "./errors.js";
import type {
  GenerationRequirements,
  ModelCapability,
  ModelSelection,
  ModelSelectionPolicy,
  ProviderProfile
} from "./types.js";

export class ModelCatalog {
  constructor(
    readonly models: ModelCapability[],
    readonly profiles: ProviderProfile[]
  ) {}

  resolve(requirements: GenerationRequirements, policy: ModelSelectionPolicy): ModelSelection {
    const providers = policy.allowedProviders ?? requirements.preferredProviders;
    const enabled = this.models.filter(
      (model) => model.enabled && (!providers || providers.includes(model.providerId))
    );
    const ranked = enabled
      .map((model) => {
        const missingModalities = requirements.modalities.filter((item) => !model.modalities.includes(item));
        const missingFeatures = requirements.features.filter((item) => !model.features.includes(item));
        return { model, missingModalities, missingFeatures };
      })
      .filter((item) => item.missingModalities.length === 0)
      .filter((item) => policy.allowCapabilityDowngrade || item.missingFeatures.length === 0)
      .sort((left, right) => left.missingFeatures.length - right.missingFeatures.length);

    const best = ranked[0];
    if (!best) {
      throw validationError("MODEL_CAPABILITY_UNSUPPORTED", "No configured model satisfies the requirements", {
        modalities: requirements.modalities,
        features: requirements.features
      });
    }
    const profile = this.profiles.find((item) => item.id === best.model.providerId);
    if (!profile) throw validationError("PROVIDER_PROFILE_NOT_FOUND", best.model.providerId);
    return {
      model: best.model,
      profile,
      reasons: [
        `matched modalities: ${requirements.modalities.join(", ")}`,
        `matched ${requirements.features.length - best.missingFeatures.length}/${requirements.features.length} features`
      ],
      downgradedFeatures: best.missingFeatures
    };
  }
}
