import type { ModelInfo } from "../../../core/capabilities";
import type { GatewayEnv } from "./env";

export const CATALOG_KEY = "catalog:models";

export interface CatalogEnvelope {
  generatedAt: string;
  models: ModelInfo[];
  discovery: Array<{ provider: string; ok: boolean; error?: string }>;
}

export async function readCatalog(env: GatewayEnv): Promise<CatalogEnvelope | null> {
  return env.MODELS_KV.get<CatalogEnvelope>(CATALOG_KEY, "json");
}

export async function writeCatalog(env: GatewayEnv, catalog: CatalogEnvelope): Promise<void> {
  await env.MODELS_KV.put(CATALOG_KEY, JSON.stringify(catalog));
  await Promise.all(
    catalog.models.map((model) => env.MODELS_KV.put(`pricing:${model.id}`, JSON.stringify(model.pricing)))
  );
}
