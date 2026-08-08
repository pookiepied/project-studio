import { createDeepSeek } from "@ai-sdk/deepseek";
import { getTransport } from "@/platform/cloudflare/aiGateway";
import type { HandlerContext } from "@/providers/types";

export function createDeepSeekClient(context: HandlerContext) {
  const transport = getTransport("deepseek", context.env);
  return createDeepSeek({
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch
  });
}
