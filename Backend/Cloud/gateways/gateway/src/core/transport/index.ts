import type { GatewayEnv } from "../../system/infrastructure/cloudflare/env";
import {
  cloudflareGatewayTransport,
  withCloudflareGatewayFetch,
  type TransportConfig
} from "./cloudflareGateway";
import { directKeyTransport } from "./directKeys";

const CF_NATIVE_PROVIDERS = new Set([
  "openai",
  "google",
  "anthropic",
  "groq",
  "xai",
  "deepseek",
  "mistral",
  "fal",
  "replicate",
  "elevenlabs",
  "openrouter",
  "alibaba",
  "minimax",
  "zai",
  "xiaomi"
]);

export function getTransport(provider: string, env: GatewayEnv, fetchImpl?: typeof fetch): TransportConfig {
  if (CF_NATIVE_PROVIDERS.has(provider)) {
    const transport = cloudflareGatewayTransport(provider, env);
    return {
      ...transport,
      fetch: withCloudflareGatewayFetch(fetchImpl)
    };
  }

  return directKeyTransport(provider, env);
}
