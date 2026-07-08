import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getTransport } from "../../../core/transport";
import type { HandlerContext } from "../../../core/registry";

// MiniMax's official API is OpenAI-wire-compatible but has NO CF-native slug, so it is added
// through Cloudflare AI Gateway's CUSTOM provider mechanism + the official
// @ai-sdk/openai-compatible package. The CF custom provider (created in the dashboard with
// base_url https://api.minimax.io/v1) is reached at `.../custom-minimax/<path>`, so the bare
// CF baseURL resolves to `/chat/completions`. MiniMax authenticates with a Bearer
// `Authorization` header (OpenAI family), injected by CF's stored-key (BYOK) alias — same
// mechanism verified for Alibaba/OpenRouter.
export function createMinimaxClient(context: HandlerContext) {
  const transport = getTransport("minimax", context.env);
  return createOpenAICompatible({
    name: "minimax",
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch,
    includeUsage: true
  });
}
