import { createXai } from "@ai-sdk/xai";
import { getTransport } from "../../../core/transport";
import type { HandlerContext } from "../../../core/registry";

export function createXaiClient(context: HandlerContext) {
  const transport = getTransport("xai", context.env);
  return createXai({
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch
  });
}
