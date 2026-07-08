import type { ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { REPLICATE_SEED_MODELS } from "./seed";

export { REPLICATE_SEED_MODELS } from "./seed";

// Replicate exposes no simple runnable-model list, so the catalog is the static seed
// regardless of env. Signature matches the other providers' listX(context).
export async function listReplicateModels(
  _context: { env?: GatewayEnv; fetch?: typeof fetch } = {}
): Promise<ModelInfo[]> {
  return REPLICATE_SEED_MODELS;
}
