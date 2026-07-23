import { createReplicate } from "@ai-sdk/replicate";
import { getTransport } from "@/platform/cloudflare/aiGateway";
import type { HandlerContext } from "@/providers/types";

export function createReplicateClient(context: HandlerContext) {
  const transport = getTransport("replicate", context.env);
  return createReplicate({
    baseURL: transport.baseURL,
    apiToken: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch
  });
}
