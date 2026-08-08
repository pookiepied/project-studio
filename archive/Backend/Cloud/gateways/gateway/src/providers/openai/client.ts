import { createOpenAI } from "@ai-sdk/openai";
import { getTransport } from "@/platform/cloudflare/aiGateway";
import type { HandlerContext } from "@/providers/types";

export function createOpenAIClient(context: HandlerContext) {
  const transport = getTransport("openai", context.env);
  return createOpenAI({
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch,
    name: "openai"
  });
}

