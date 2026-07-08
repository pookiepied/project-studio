import { type ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { discoverXaiModelIds } from "./discovery";
import { createXaiModelFromId } from "./metadata";
import { XAI_SEED_MODELS } from "./seed";

export { XAI_SEED_MODELS } from "./seed";

export async function listXaiModels(context: { env?: GatewayEnv; fetch?: typeof fetch } = {}): Promise<ModelInfo[]> {
  if (!context.env) {
    return XAI_SEED_MODELS;
  }

  const liveModels = (await discoverXaiModelIds({ env: context.env, fetch: context.fetch }))
    .map((model) => createXaiModelFromId(model.id, model.created))
    .filter((model): model is ModelInfo => Boolean(model));

  if (liveModels.length === 0) {
    return XAI_SEED_MODELS;
  }

  // De-duplicate: prefer live-discovered models, then append any seed model not surfaced
  // live (so a temporarily-unlisted Grok model still resolves for routing).
  const liveIds = new Set(liveModels.map((model) => model.id));
  const seededExtras = XAI_SEED_MODELS.filter((model) => !liveIds.has(model.id));

  return [...liveModels, ...seededExtras];
}
