import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getTransport } from "../../../core/transport";
import type { HandlerContext } from "../../../core/registry";

// Alibaba Model Studio (DashScope) is OpenAI-wire-compatible but has NO CF-native slug, so it
// is added through Cloudflare AI Gateway's CUSTOM provider mechanism + the official
// @ai-sdk/openai-compatible package. The CF custom provider (created in the dashboard with
// base_url https://dashscope-intl.aliyuncs.com/compatible-mode/v1) is reached at
// `.../custom-alibaba/<path>`, so the bare CF baseURL resolves to `/chat/completions`.
// DashScope authenticates with a Bearer `Authorization` header (OpenAI family). NOTE: for
// CUSTOM providers, whether Cloudflare injects a stored key (BYOK alias) or requires the key
// inline is being verified on the live dashboard — the transport below sends the same
// keyless/alias headers as the native providers; if CF custom providers need an inline key we
// switch this one provider to forward the caller's Authorization instead of stripping it.
export function createAlibabaClient(context: HandlerContext) {
  const transport = getTransport("alibaba", context.env);
  return createOpenAICompatible({
    name: "alibaba",
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch,
    includeUsage: true
  });
}
