import { type ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { discoverAnthropicModelIds } from "./discovery";
import { createAnthropicModelFromId } from "./metadata";
import { ANTHROPIC_SEED_MODELS } from "./seed";

export { ANTHROPIC_SEED_MODELS } from "./seed";

export async function listAnthropicModels(
  context: { env?: GatewayEnv; fetch?: typeof fetch } = {}
): Promise<ModelInfo[]> {
  if (!context.env) {
    return ANTHROPIC_SEED_MODELS;
  }

  const liveModels = (await discoverAnthropicModelIds({ env: context.env, fetch: context.fetch }))
    .map((model) => createAnthropicModelFromId(model.id, model.created))
    .filter((model): model is ModelInfo => Boolean(model));

  if (liveModels.length === 0) {
    return ANTHROPIC_SEED_MODELS;
  }

  // Keep any curated seed models the live listing didn't return, so the catalog never
  // regresses below the reviewed lineup.
  const liveIds = new Set(liveModels.map((model) => model.id));
  const seededMissingModels = ANTHROPIC_SEED_MODELS.filter((model) => !liveIds.has(model.id));

  return [...liveModels, ...seededMissingModels];
}
