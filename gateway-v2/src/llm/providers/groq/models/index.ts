import { type ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { discoverGroqModelIds } from "./discovery";
import { createGroqModelFromId } from "./metadata";
import { GROQ_SEED_MODELS } from "./seed";

export { GROQ_SEED_MODELS } from "./seed";

export async function listGroqModels(context: { env?: GatewayEnv; fetch?: typeof fetch } = {}): Promise<ModelInfo[]> {
  if (!context.env) {
    return GROQ_SEED_MODELS;
  }

  // createGroqModelFromId returns undefined for guard/safety models, so they never enter the
  // catalog even though Groq's /models endpoint lists them.
  const liveModels = (await discoverGroqModelIds({ env: context.env, fetch: context.fetch }))
    .map((model) => createGroqModelFromId(model.id, model.created))
    .filter((model): model is ModelInfo => Boolean(model));

  if (liveModels.length === 0) {
    return GROQ_SEED_MODELS;
  }

  // Keep any curated seed models the live listing didn't return, so the catalog never
  // regresses below the reviewed lineup (and retains reviewed pricing/capabilities).
  const liveIds = new Set(liveModels.map((model) => model.id));
  const seededMissingModels = GROQ_SEED_MODELS.filter((model) => !liveIds.has(model.id));

  return [...liveModels, ...seededMissingModels];
}
