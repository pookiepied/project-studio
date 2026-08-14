import type { ProviderRuntime } from "../contract.ts";
import { googleChat } from "./sdk.ts";
import { googleCapabilities } from "./capabilities.ts";

export const googleProvider: ProviderRuntime = {
  providerId: "google",
  protocol: "google-generative-ai",
  async chat(req) {
    return googleChat(req);
  },
  async discover(apiKey, baseUrl) {
    const { googleGenerativeAdapter } = await import("../../adapters/google-generative-ai/adapter.ts");
    return googleGenerativeAdapter.discover(apiKey, baseUrl);
  },
};

export { googleCapabilities };
