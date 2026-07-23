import type { ModelInfo } from "@/domain/models/capabilities";
import type { ProviderId } from "@/domain/contracts";
import { MANUAL_MODEL_REGISTRY, MANUAL_REGISTRY_GENERATED_AT, MANUAL_REGISTRY_VERSION } from "./models";
import type { ModelRegistry, RegistryProviderSummary } from "./schema";
import { findRegistryModel, validateRegistry } from "./integrity";

let cachedCatalog: ModelRegistry | undefined;

export function getModelCatalog(): ModelRegistry {
  if (!cachedCatalog) {
    cachedCatalog = {
      version: MANUAL_REGISTRY_VERSION,
      generatedAt: MANUAL_REGISTRY_GENERATED_AT,
      source: "studio-curated",
      models: MANUAL_MODEL_REGISTRY,
      providers: summarizeProviders(MANUAL_MODEL_REGISTRY)
    };
    validateRegistry(cachedCatalog);
  }
  return cachedCatalog;
}

export function getCatalog(): ModelInfo[] {
  return getModelCatalog().models;
}

export function getModel(modelId: string) {
  return findRegistryModel(getModelCatalog().models, modelId);
}

function summarizeProviders(models: ModelRegistry["models"]): RegistryProviderSummary[] {
  const providerIds = Array.from(new Set(models.map((model) => model.provider))).sort() as ProviderId[];
  return providerIds.map((provider) => {
    const providerModels = models.filter((model) => model.provider === provider);
    return {
      provider,
      status: "active",
      modelCount: providerModels.length,
      categories: Array.from(new Set(providerModels.map((model) => model.registry.category))).sort()
    };
  });
}
