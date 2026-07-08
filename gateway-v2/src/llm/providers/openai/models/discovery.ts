import { getTransport } from "../../../../core/transport";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";

interface OpenAIModelsResponse {
  data?: Array<{ id: string; created?: number }>;
}

export async function discoverOpenAIModelIds(context: {
  env: GatewayEnv;
  fetch?: typeof fetch;
}): Promise<Array<{ id: string; created?: number }>> {
  const transport = getTransport("openai", context.env, context.fetch);
  const response = await transport.fetch(`${transport.baseURL}/models`, {
    headers: transport.headers
  });

  if (!response.ok) {
    throw new Error(`OpenAI model discovery failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as OpenAIModelsResponse;
  return body.data ?? [];
}

