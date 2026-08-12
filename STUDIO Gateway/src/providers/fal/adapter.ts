/**
 * fal adapter - image/video generation, OpenAI-compatible for now
 * Fal primary is image generation, but gateway exposes via same discovery
 */
import { openAICompletionsAdapter } from "../../adapters/openai-completions/adapter.ts";
import type { Adapter } from "../registry.ts";

export const adapter: Adapter = {
  protocol: "openai-completions",
  discover: openAICompletionsAdapter.discover,
  async chat(apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response> {
    // Fal image generation uses different endpoint, for now passthrough chat
    return openAICompletionsAdapter.chat(apiKey, baseUrl, body, signal);
  },
};
