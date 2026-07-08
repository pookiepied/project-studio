import { getTransport } from "../../../../core/transport";
import type { GatewayEnv } from "../../../../system/infrastructure/cloudflare/env";

// Anthropic exposes a Models API (`GET /v1/models`) that lists the models the key can
// reach. Through CF AI Gateway the native Anthropic path already carries the `/v1`
// segment (see cloudflareGateway PROVIDER_API_BASE_PATHS), so the listing lives at
// `${baseURL}/models`. The endpoint requires the `anthropic-version` header (the chat
// SDK sets it automatically; here we set it explicitly for the raw fetch). BYOK injects
// the real key, so no `x-api-key` is sent.
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicModelsResponse {
  data?: Array<{ id: string; created_at?: string }>;
}

export async function discoverAnthropicModelIds(context: {
  env: GatewayEnv;
  fetch?: typeof fetch;
}): Promise<Array<{ id: string; created?: number }>> {
  const transport = getTransport("anthropic", context.env, context.fetch);
  const response = await transport.fetch(`${transport.baseURL}/models`, {
    headers: {
      ...transport.headers,
      "anthropic-version": ANTHROPIC_VERSION
    }
  });

  if (!response.ok) {
    throw new Error(`Anthropic model discovery failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as AnthropicModelsResponse;
  return (body.data ?? []).map((model) => ({
    id: model.id,
    created: model.created_at ? Math.floor(Date.parse(model.created_at) / 1000) || undefined : undefined
  }));
}
