import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getTransport } from "@/platform/cloudflare/aiGateway";
import type { HandlerContext } from "@/providers/types";

// Xiaomi MiMo's official API is OpenAI-wire-compatible but has NO CF-native slug, so it is
// added through Cloudflare AI Gateway's CUSTOM provider mechanism + the official
// @ai-sdk/openai-compatible package. The CF custom provider (created in the dashboard with
// base_url https://api.xiaomimimo.com/v1) is reached at `.../custom-xiaomi/<path>`, so the
// bare CF baseURL resolves to `/chat/completions`. MiMo accepts either an `api-key` header or
// a Bearer `Authorization` header; we use `Authorization` (OpenAI family) so it is injected by
// CF's stored-key (BYOK) alias the same way as the other custom providers.
export function createXiaomiClient(context: HandlerContext) {
  const transport = getTransport("xiaomi", context.env);
  return createOpenAICompatible({
    name: "xiaomi",
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch,
    includeUsage: true
  });
}
