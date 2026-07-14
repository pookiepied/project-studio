import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getTransport } from "../../../core/transport";
import type { HandlerContext } from "../../../core/registry";

export function createGoogleClient(context: HandlerContext) {
  const transport = getTransport("google", context.env);
  return createGoogleGenerativeAI({
    baseURL: transport.baseURL,
    apiKey: "unused-byok-placeholder",
    headers: transport.headers,
    fetch: transport.fetch,
    name: "google"
  });
}

