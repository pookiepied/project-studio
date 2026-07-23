import { createAnthropic } from "@ai-sdk/anthropic";
import { getTransport } from "@/platform/cloudflare/aiGateway";
import type { HandlerContext } from "@/providers/types";

export function createAnthropicClient(context: HandlerContext) {
  const transport = getTransport("anthropic", context.env);
  return createAnthropic({
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch,
    name: "anthropic"
  });
}
