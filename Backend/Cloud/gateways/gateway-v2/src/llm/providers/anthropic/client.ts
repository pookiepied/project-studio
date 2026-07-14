import { createAnthropic } from "@ai-sdk/anthropic";
import { getTransport } from "../../../core/transport";
import type { HandlerContext } from "../../../core/registry";

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
