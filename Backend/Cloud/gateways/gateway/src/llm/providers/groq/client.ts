import { createGroq } from "@ai-sdk/groq";
import { getTransport } from "../../../core/transport";
import type { HandlerContext } from "../../../core/registry";

export function createGroqClient(context: HandlerContext) {
  const transport = getTransport("groq", context.env);
  return createGroq({
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch
  });
}
