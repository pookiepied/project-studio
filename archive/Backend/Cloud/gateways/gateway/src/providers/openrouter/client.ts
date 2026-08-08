import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getTransport } from "@/platform/cloudflare/aiGateway";
import type { HandlerContext } from "@/providers/types";

// OpenRouter has no first-party @ai-sdk/openrouter package, so it is added through the
// official @ai-sdk/openai-compatible provider (OpenRouter speaks the OpenAI wire format).
// It routes through Cloudflare AI Gateway exactly like the native providers: CF slug
// `openrouter` maps `.../openrouter/<path>` -> `https://openrouter.ai/api/v1/<path>`, so the
// bare CF baseURL resolves to `/chat/completions` and `/models`. OpenRouter authenticates
// with a Bearer `Authorization` header, which is injected by CF BYOK (alias) and stripped
// from the outbound worker request by stripProviderAuthorization - the placeholder apiKey
// below never leaves the worker.
//
// The provider `name` ("openrouter") is also the providerOptions key: reasoning effort is
// passed via providerOptions.openrouter.reasoningEffort (see ./chat.ts).
export function createOpenRouterClient(context: HandlerContext) {
  const transport = getTransport("openrouter", context.env);
  return createOpenAICompatible({
    name: "openrouter",
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch,
    includeUsage: true
  });
}
