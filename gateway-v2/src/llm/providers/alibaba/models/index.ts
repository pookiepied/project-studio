import type { ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { ALIBABA_SEED_MODELS } from "./seed";

export { ALIBABA_SEED_MODELS } from "./seed";

// Alibaba's catalog is a static seed for now (see ./seed.ts). Signature matches the other
// providers' listX(context) so live discovery can be added later without touching callers.
export async function listAlibabaModels(
  _context: { env?: GatewayEnv; fetch?: typeof fetch } = {}
): Promise<ModelInfo[]> {
  return ALIBABA_SEED_MODELS;
}
