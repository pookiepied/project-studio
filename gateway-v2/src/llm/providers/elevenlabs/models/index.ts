import type { ModelInfo } from "../../../../core/capabilities";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";
import { ELEVENLABS_SEED_MODELS } from "./seed";

export { ELEVENLABS_SEED_MODELS } from "./seed";

// ElevenLabs' model list is small and static; the catalog is the seed regardless of env.
// Signature matches the other providers' listX(context).
export async function listElevenLabsModels(
  _context: { env?: GatewayEnv; fetch?: typeof fetch } = {}
): Promise<ModelInfo[]> {
  return ELEVENLABS_SEED_MODELS;
}
