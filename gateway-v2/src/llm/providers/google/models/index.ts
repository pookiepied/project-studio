import type { ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { discoverGoogleModels } from "./discovery";
import { createGoogleModelFromDiscovery } from "./metadata";
import { GOOGLE_SEED_MODELS } from "./seed";

export { GOOGLE_SEED_MODELS } from "./seed";

export async function listGoogleModels(context: { env?: GatewayEnv; fetch?: typeof fetch } = {}): Promise<ModelInfo[]> {
  if (!context.env) {
    return GOOGLE_SEED_MODELS;
  }

  const liveModels = (await discoverGoogleModels({ env: context.env, fetch: context.fetch }))
    .map(createGoogleModelFromDiscovery)
    .filter((model): model is ModelInfo => Boolean(model));

  if (liveModels.length === 0) {
    return GOOGLE_SEED_MODELS;
  }

  const liveIds = new Set(liveModels.map((model) => model.id));
  const seededMissingModels = GOOGLE_SEED_MODELS.filter((model) => !liveIds.has(model.id));

  return [...liveModels, ...seededMissingModels];
}

