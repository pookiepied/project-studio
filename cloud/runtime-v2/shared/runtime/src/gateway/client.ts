import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

/**
 * Model access via Gateway v2 (a `GATEWAY` service binding, passed in). The
 * gateway exposes an OpenAI-compatible /v1/chat/completions surface, so every
 * runtime uses the AI SDK's openai-compatible provider with fetch routed
 * through the binding. Runtimes never talk to providers directly and never
 * hold provider credentials.
 */

// Hostname is arbitrary for service bindings — routing is by binding, not DNS.
const GATEWAY_BASE_URL = "https://studio-gateway.internal/v1";

export function gatewayModel(gateway: Fetcher, modelId: string): LanguageModel {
  const provider = createOpenAICompatible({
    name: "studio-gateway",
    baseURL: GATEWAY_BASE_URL,
    fetch: ((input, init) =>
      gateway.fetch(input as RequestInfo, init)) as typeof fetch,
  });
  return provider.chatModel(modelId);
}
