import type { ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { ZAI_SEED_MODELS } from "./seed";

export { ZAI_SEED_MODELS } from "./seed";

// Z.AI's catalog is a static seed for now (see ./seed.ts). Signature matches the other
// providers' listX(context) so live discovery can be added later without touching callers.
export async function listZaiModels(
  _context: { env?: GatewayEnv; fetch?: typeof fetch } = {}
): Promise<ModelInfo[]> {
  return ZAI_SEED_MODELS;
}
