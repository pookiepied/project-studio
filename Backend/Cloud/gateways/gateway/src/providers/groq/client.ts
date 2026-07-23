import { createGroq } from "@ai-sdk/groq";
import { getTransport } from "@/platform/cloudflare/aiGateway";
import type { HandlerContext } from "@/providers/types";

export function createGroqClient(context: HandlerContext) {
  const transport = getTransport("groq", context.env);
  return createGroq({
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch
  });
}
