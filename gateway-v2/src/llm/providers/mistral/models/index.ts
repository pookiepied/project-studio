import { type ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { discoverMistralModelIds } from "./discovery";
import { createMistralModelFromId } from "./metadata";
import { MISTRAL_SEED_MODELS } from "./seed";

export { MISTRAL_SEED_MODELS } from "./seed";

export async function listMistralModels(context: { env?: GatewayEnv; fetch?: typeof fetch } = {}): Promise<ModelInfo[]> {
  if (!context.env) {
    return MISTRAL_SEED_MODELS;
  }

  const liveModels = (await discoverMistralModelIds({ env: context.env, fetch: context.fetch }))
    .map((model) => createMistralModelFromId(model.id, model.created))
    .filter((model): model is ModelInfo => Boolean(model));

  if (liveModels.length === 0) {
    return MISTRAL_SEED_MODELS;
  }

  // De-duplicate: prefer live-discovered models, then append any seed model not surfaced live
  // (so a temporarily-unlisted Mistral model still resolves for routing).
  const liveIds = new Set(liveModels.map((model) => model.id));
  const seededExtras = MISTRAL_SEED_MODELS.filter((model) => !liveIds.has(model.id));

  return [...liveModels, ...seededExtras];
}
