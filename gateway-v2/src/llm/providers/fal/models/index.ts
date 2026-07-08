import type { ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { FAL_SEED_MODELS } from "./seed";

export { FAL_SEED_MODELS } from "./seed";

// Fal exposes no machine-readable model list, so the catalog is the static seed regardless of
// env. The signature matches the other providers' listX(context) so the registry can call it
// uniformly.
export async function listFalModels(_context: { env?: GatewayEnv; fetch?: typeof fetch } = {}): Promise<ModelInfo[]> {
  return FAL_SEED_MODELS;
}
