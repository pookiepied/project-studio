/**
 * minimax adapter - no store
 */
import { openAICompletionsAdapter } from "../../adapters/openai-completions/adapter.ts";
import type { Adapter } from "../registry.ts";

export const adapter: Adapter = {
  protocol: "openai-completions",
  discover: openAICompletionsAdapter.discover,
  async chat(apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const out = { ...(body as Record<string, unknown>) };
    delete out.store;
    return openAICompletionsAdapter.chat(apiKey, baseUrl, out, signal);
  },
};