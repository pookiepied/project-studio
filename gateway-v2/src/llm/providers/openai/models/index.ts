import { Capability, type ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { discoverOpenAIModelIds } from "./discovery";
import { createOpenAIModelFromId } from "./metadata";
import { OPENAI_SEED_MODELS } from "./seed";

export { OPENAI_SEED_MODELS } from "./seed";

export async function listOpenAIModels(context: { env?: GatewayEnv; fetch?: typeof fetch } = {}): Promise<ModelInfo[]> {
  if (!context.env) {
    return OPENAI_SEED_MODELS;
  }

  const liveModels = (await discoverOpenAIModelIds({ env: context.env, fetch: context.fetch }))
    .map((model) => createOpenAIModelFromId(model.id, model.created))
    .filter((model): model is ModelInfo => Boolean(model));

  if (liveModels.length === 0) {
    return OPENAI_SEED_MODELS;
  }

  const liveIds = new Set(liveModels.map((model) => model.id));
  const seededNonChatModels = OPENAI_SEED_MODELS.filter(
    (model) => !model.capabilities.modalities.includes(Capability.Chat) && !liveIds.has(model.id)
  );

  return [...liveModels, ...seededNonChatModels];
}

