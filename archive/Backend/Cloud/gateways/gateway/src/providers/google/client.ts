import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getTransport } from "@/platform/cloudflare/aiGateway";
import type { HandlerContext } from "@/providers/types";

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

