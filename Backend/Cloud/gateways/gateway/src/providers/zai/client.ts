import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getTransport } from "@/platform/cloudflare/aiGateway";
import type { HandlerContext } from "@/providers/types";

// Z.AI (GLM) is OpenAI-wire-compatible but has NO CF-native slug, so it is added through
// Cloudflare AI Gateway's CUSTOM provider mechanism + the official @ai-sdk/openai-compatible
// package. The CF custom provider (created in the dashboard with base_url
// https://api.z.ai/api/paas/v4 - the general endpoint, NOT the coding-plan-only
// /api/coding/paas/v4) is reached at `.../custom-zai/<path>`, so the bare CF baseURL resolves
// to `/chat/completions`. Z.AI authenticates with a Bearer `Authorization` header (OpenAI
// family), injected by CF's stored-key (BYOK) alias.
export function createZaiClient(context: HandlerContext) {
  const transport = getTransport("zai", context.env);
  return createOpenAICompatible({
    name: "zai",
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch,
    includeUsage: true
  });
}
