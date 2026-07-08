import { getTransport } from "../../../../core/transport";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";

// Groq exposes an OpenAI-compatible Models API. Through CF AI Gateway the `groq` slug proxies
// `.../groq/models` → `https://api.groq.com/openai/v1/models`, so the listing lives at
// `${baseURL}/models`. BYOK injects the real key; the Bearer Authorization header is stripped.
interface GroqModelsResponse {
  data?: Array<{ id: string; created?: number }>;
}

export async function discoverGroqModelIds(context: {
  env: GatewayEnv;
  fetch?: typeof fetch;
}): Promise<Array<{ id: string; created?: number }>> {
  const transport = getTransport("groq", context.env, context.fetch);
  const response = await transport.fetch(`${transport.baseURL}/models`, {
    headers: transport.headers
  });

  if (!response.ok) {
    throw new Error(`Groq model discovery failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as GroqModelsResponse;
  return body.data ?? [];
}
