import { getTransport } from "../../../../core/transport";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";

// DeepSeek exposes a live OpenAI-compatible /models endpoint that returns model IDs but
// NO pricing. Pricing is applied from the static table (./pricing.ts) when each id is
// mapped to a ModelInfo in ./metadata.ts. Mirrors the OpenAI/xAI discovery flow.
//
// Confirmed endpoints (as of 2026-07-05):
//   - Native: https://api.deepseek.com/models  (OpenAI format; the SDK default baseURL
//     is https://api.deepseek.com with no /v1, and appends /chat/completions)
//   - Through CF AI Gateway: https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/deepseek/models
interface DeepSeekModelsResponse {
  data?: Array<{ id: string; created?: number }>;
}

export async function discoverDeepSeekModelIds(context: {
  env: GatewayEnv;
  fetch?: typeof fetch;
}): Promise<Array<{ id: string; created?: number }>> {
  const transport = getTransport("deepseek", context.env, context.fetch);
  const response = await transport.fetch(`${transport.baseURL}/models`, {
    headers: transport.headers
  });

  if (!response.ok) {
    throw new Error(`DeepSeek model discovery failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as DeepSeekModelsResponse;
  return body.data ?? [];
}
