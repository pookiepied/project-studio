import { createMistral } from "@ai-sdk/mistral";
import { getTransport } from "@/platform/cloudflare/aiGateway";
import type { HandlerContext } from "@/providers/types";

export function createMistralClient(context: HandlerContext) {
  const transport = getTransport("mistral", context.env);
  return createMistral({
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch
  });
}
