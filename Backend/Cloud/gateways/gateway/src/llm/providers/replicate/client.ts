import { createReplicate } from "@ai-sdk/replicate";
import { getTransport } from "../../../core/transport";
import type { HandlerContext } from "../../../core/registry";

export function createReplicateClient(context: HandlerContext) {
  const transport = getTransport("replicate", context.env);
  return createReplicate({
    baseURL: transport.baseURL,
    apiToken: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch
  });
}
