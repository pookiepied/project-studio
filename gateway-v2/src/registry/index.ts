import type { ModelInfo } from "../core/capabilities";
import type { ProviderId } from "../core/types";
import type { GatewayEnv } from "../system/infrastructure/cloudflare/env";
import { MANUAL_MODEL_REGISTRY, MANUAL_REGISTRY_GENERATED_AT, MANUAL_REGISTRY_VERSION } from "./manualCatalog";
import type { ModelRegistry, RegistryModel, RegistryProviderSummary } from "./schema";
import { findRegistryModel, validateRegistry } from "./validate";

const PERSISTED_REGISTRY_KEY = "model-registry:v1";

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

export async function getModelRegistryForEnv(env: Pick<GatewayEnv, "MODEL_REGISTRY_KV"> | undefined): Promise<ModelRegistry> {
  const base = getModelRegistry();
  const persisted = await readPersistedRegistryModels(env);
  if (!persisted.length) return base;

  const merged = mergeRegistryModels(base.models, persisted);
  const registry: ModelRegistry = {
    ...base,
    version: `${base.version}+admin`,
    generatedAt: new Date().toISOString(),
    models: merged,
    providers: summarizeProviders(merged)
  };
  validateRegistry(registry);
  return registry;
}

export async function getRegistryModelForEnv(
  env: Pick<GatewayEnv, "MODEL_REGISTRY_KV"> | undefined,
  modelId: string
): Promise<RegistryModel | undefined> {
  return findRegistryModel((await getModelRegistryForEnv(env)).models, modelId);
}

export async function readPersistedRegistryModels(env: Pick<GatewayEnv, "MODEL_REGISTRY_KV"> | undefined): Promise<RegistryModel[]> {
  if (!env?.MODEL_REGISTRY_KV) return [];
  const stored = await env.MODEL_REGISTRY_KV.get(PERSISTED_REGISTRY_KEY, "json");
  if (!stored || typeof stored !== "object") return [];
  const models = (stored as { models?: unknown }).models;
  return Array.isArray(models) ? (models as RegistryModel[]) : [];
}

export async function writePersistedRegistryModels(
  env: Pick<GatewayEnv, "MODEL_REGISTRY_KV">,
  models: RegistryModel[]
): Promise<void> {
  if (!env.MODEL_REGISTRY_KV) {
    throw new Error("MODEL_REGISTRY_KV is not configured.");
  }
  const payload = {
    version: `${MANUAL_REGISTRY_VERSION}.admin`,
    updatedAt: new Date().toISOString(),
    models
  };
  await env.MODEL_REGISTRY_KV.put(PERSISTED_REGISTRY_KEY, JSON.stringify(payload));
}

export function mergeRegistryModels(baseModels: RegistryModel[], persistedModels: RegistryModel[]): RegistryModel[] {
  const byId = new Map<string, RegistryModel>();
  for (const model of baseModels) byId.set(model.id, model);
  for (const model of persistedModels) byId.set(model.id, model);
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
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
