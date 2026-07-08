import { createFal } from "@ai-sdk/fal";
import { getTransport } from "../../../core/transport";
import type { HandlerContext } from "../../../core/registry";

export function createFalClient(context: HandlerContext) {
  const transport = getTransport("fal", context.env);
  return createFal({
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch
  });
}
