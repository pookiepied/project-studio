import { createOpenAI } from "@ai-sdk/openai";
import { getTransport } from "../../../core/transport";
import type { HandlerContext } from "../../../core/registry";

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

