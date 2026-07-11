import type { ModelInfo } from "../core/capabilities";
import type { ProviderId } from "../core/types";
import { MANUAL_MODEL_REGISTRY, MANUAL_REGISTRY_GENERATED_AT, MANUAL_REGISTRY_VERSION } from "./manualCatalog";
import type { ModelRegistry, RegistryProviderSummary } from "./schema";
import { findRegistryModel, validateRegistry } from "./validate";

let cachedRegistry: ModelRegistry | undefined;

export function getModelRegistry(): ModelRegistry {
  if (!cachedRegistry) {
    cachedRegistry = {
      version: MANUAL_REGISTRY_VERSION,
      generatedAt: MANUAL_REGISTRY_GENERATED_AT,
      source: "studio-curated",
      models: MANUAL_MODEL_REGISTRY,
      providers: summarizeProviders(MANUAL_MODEL_REGISTRY)
    };
    validateRegistry(cachedRegistry);
  }
  return cachedRegistry;
}

export function getCatalog(): ModelInfo[] {
  return getModelRegistry().models;
}

export function getModel(modelId: string): ModelInfo | undefined {
  return findRegistryModel(getModelRegistry().models, modelId);
}

export function getRegistryModel(modelId: string) {
  return findRegistryModel(getModelRegistry().models, modelId);
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
