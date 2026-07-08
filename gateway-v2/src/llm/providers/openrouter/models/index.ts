import { type ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { discoverOpenRouterModels } from "./discovery";
import { createOpenRouterModelFromApi } from "./metadata";
import { OPENROUTER_SEED_MODELS } from "./seed";

export { OPENROUTER_SEED_MODELS } from "./seed";

// Live-first catalog: discover OpenRouter's models (real pricing + capabilities), keep only the
// in-scope text/multimodal chat models, and fall back to the static seed when discovery cannot
// run or returns nothing. Mirrors the Mistral discovery flow.
export async function listOpenRouterModels(
  context: { env?: GatewayEnv; fetch?: typeof fetch } = {}
): Promise<ModelInfo[]> {
  if (!context.env) {
    return OPENROUTER_SEED_MODELS;
  }

  const liveModels = (await discoverOpenRouterModels({ env: context.env, fetch: context.fetch }))
    .map((model) => createOpenRouterModelFromApi(model))
    .filter((model): model is ModelInfo => Boolean(model));

  if (liveModels.length === 0) {
    return OPENROUTER_SEED_MODELS;
  }

  // De-duplicate: prefer live-discovered models, then append any seed model not surfaced live.
  const liveIds = new Set(liveModels.map((model) => model.id));
  const seededExtras = OPENROUTER_SEED_MODELS.filter((model) => !liveIds.has(model.id));

  return [...liveModels, ...seededExtras];
}
