import { createMistral } from "@ai-sdk/mistral";
import { getTransport } from "../../../core/transport";
import type { HandlerContext } from "../../../core/registry";

export function createMistralClient(context: HandlerContext) {
  const transport = getTransport("mistral", context.env);
  return createMistral({
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch
  });
}
