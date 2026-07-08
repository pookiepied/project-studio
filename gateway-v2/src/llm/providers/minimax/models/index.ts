import type { ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { MINIMAX_SEED_MODELS } from "./seed";

export { MINIMAX_SEED_MODELS } from "./seed";

// MiniMax's catalog is a static seed for now (see ./seed.ts). Signature matches the other
// providers' listX(context) so live discovery can be added later without touching callers.
export async function listMinimaxModels(
  _context: { env?: GatewayEnv; fetch?: typeof fetch } = {}
): Promise<ModelInfo[]> {
  return MINIMAX_SEED_MODELS;
}
