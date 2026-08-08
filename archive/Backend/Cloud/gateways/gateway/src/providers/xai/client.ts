import { createXai } from "@ai-sdk/xai";
import { getTransport } from "@/platform/cloudflare/aiGateway";
import type { HandlerContext } from "@/providers/types";

export function createXaiClient(context: HandlerContext) {
  const transport = getTransport("xai", context.env);
  return createXai({
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch
  });
}
