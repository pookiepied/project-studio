import { getTransport } from "../../../../core/transport";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";

// xAI exposes a live OpenAI-compatible /v1/models endpoint that returns model IDs but
// NO pricing. Pricing is applied from the static table (./pricing.ts) when each id is
// mapped to a ModelInfo in ./metadata.ts. Mirrors the OpenAI discovery flow.
//
// Confirmed endpoints (as of 2026-07-05):
//   - Native: https://api.x.ai/v1/models
//   - Through CF AI Gateway: https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/grok/models
interface XaiModelsResponse {
  data?: Array<{ id: string; created?: number }>;
}

export async function discoverXaiModelIds(context: {
  env: GatewayEnv;
  fetch?: typeof fetch;
}): Promise<Array<{ id: string; created?: number }>> {
  const transport = getTransport("xai", context.env, context.fetch);
  const response = await transport.fetch(`${transport.baseURL}/models`, {
    headers: transport.headers
  });

  if (!response.ok) {
    throw new Error(`xAI model discovery failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as XaiModelsResponse;
  return body.data ?? [];
}
