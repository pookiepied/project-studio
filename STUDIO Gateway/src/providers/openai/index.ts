import type { ProviderRuntime } from "../contract.ts";
import { openAIChat, openAIEmbed, openAIImage, openAISpeech, openAITranscribe } from "./sdk.ts";
import { openAICapabilities } from "./capabilities.ts";

export const openAIProvider: ProviderRuntime = {
  providerId: "openai",
  protocol: "openai-completions",
  async chat(req) { return openAIChat(req); },
  async discover(apiKey, baseUrl) {
    const { openAICompletionsAdapter } = await import("../../adapters/openai-completions/adapter.ts");
    return openAICompletionsAdapter.discover(apiKey, baseUrl);
  },
  async generateImage(req) { return openAIImage(req); },
  async generateSpeech(req) { return openAISpeech(req); },
  async transcribe(req) { return openAITranscribe(req); },
  async embed(req) { return openAIEmbed(req); },
};

export { openAICapabilities };
