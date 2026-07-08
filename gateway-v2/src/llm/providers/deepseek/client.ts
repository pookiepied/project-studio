import { createDeepSeek } from "@ai-sdk/deepseek";
import { getTransport } from "../../../core/transport";
import type { HandlerContext } from "../../../core/registry";

export function createDeepSeekClient(context: HandlerContext) {
  const transport = getTransport("deepseek", context.env);
  return createDeepSeek({
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch
  });
}
