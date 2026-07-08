import { type ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { discoverDeepSeekModelIds } from "./discovery";
import { createDeepSeekModelFromId } from "./metadata";
import { DEEPSEEK_SEED_MODELS } from "./seed";

export { DEEPSEEK_SEED_MODELS } from "./seed";

export async function listDeepSeekModels(context: { env?: GatewayEnv; fetch?: typeof fetch } = {}): Promise<ModelInfo[]> {
  if (!context.env) {
    return DEEPSEEK_SEED_MODELS;
  }

  const liveModels = (await discoverDeepSeekModelIds({ env: context.env, fetch: context.fetch }))
    .map((model) => createDeepSeekModelFromId(model.id, model.created))
    .filter((model): model is ModelInfo => Boolean(model));

  if (liveModels.length === 0) {
    return DEEPSEEK_SEED_MODELS;
  }

  // De-duplicate: prefer live-discovered models, then append any seed model not surfaced
  // live (so a temporarily-unlisted DeepSeek model still resolves for routing).
  const liveIds = new Set(liveModels.map((model) => model.id));
  const seededExtras = DEEPSEEK_SEED_MODELS.filter((model) => !liveIds.has(model.id));

  return [...liveModels, ...seededExtras];
}
