import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { Env } from "../system/env";

/**
 * Model access via Gateway v2 (the `GATEWAY` service binding). The gateway
 * exposes an OpenAI-compatible /v1/chat/completions surface, so the loop uses
 * the AI SDK's openai-compatible provider with fetch routed through the
 * binding. The runtime never talks to providers directly and never holds
 * provider credentials.
 */

// Hostname is arbitrary for service bindings — routing is by binding, not DNS.
const GATEWAY_BASE_URL = "https://studio-gateway.internal/v1";

export function gatewayModel(env: Env, modelId: string): LanguageModel {
  const provider = createOpenAICompatible({
    name: "studio-gateway",
    baseURL: GATEWAY_BASE_URL,
    fetch: ((input, init) =>
      env.GATEWAY.fetch(input as RequestInfo, init)) as typeof fetch,
  });
  return provider.chatModel(modelId);
}
