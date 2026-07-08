import { getTransport } from "../../../../core/transport";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";

// Mistral exposes a live OpenAI-compatible /v1/models endpoint that returns model IDs (and a
// created timestamp) but NO pricing. Pricing is applied from the static table (./pricing.ts —
// currently "unknown") when each id is mapped to a ModelInfo in ./metadata.ts. Mirrors the
// OpenAI / xAI / DeepSeek discovery flow.
//
// Confirmed endpoints (as of 2026-07-05):
//   - Native: https://api.mistral.ai/v1/models
//   - Through CF AI Gateway: https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/mistral/v1/models
interface MistralModelsResponse {
  data?: Array<{ id: string; created?: number }>;
}

export async function discoverMistralModelIds(context: {
  env: GatewayEnv;
  fetch?: typeof fetch;
}): Promise<Array<{ id: string; created?: number }>> {
  const transport = getTransport("mistral", context.env, context.fetch);
  const response = await transport.fetch(`${transport.baseURL}/models`, {
    headers: transport.headers
  });

  if (!response.ok) {
    throw new Error(`Mistral model discovery failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as MistralModelsResponse;
  return body.data ?? [];
}
