import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getTransport } from "@/platform/cloudflare/aiGateway";
import type { HandlerContext } from "@/providers/types";

// Alibaba Model Studio (DashScope) is OpenAI-wire-compatible but has NO CF-native slug, so it
// is added through Cloudflare AI Gateway's CUSTOM provider mechanism + the official
// @ai-sdk/openai-compatible package. The CF custom provider (created in the dashboard with
// base_url https://dashscope-intl.aliyuncs.com/compatible-mode/v1) is reached at
// `.../custom-alibaba/<path>`, so the bare CF baseURL resolves to `/chat/completions`.
// DashScope authenticates with a Bearer `Authorization` header (OpenAI family). Cloudflare
// injects the operator-managed stored key selected by the gateway alias.
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
