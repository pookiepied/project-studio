/**
 * xiaomi adapter - deepseek style thinking, no store
 */
import { openAICompletionsAdapter } from "../../adapters/openai-completions/adapter.ts";
import type { Adapter } from "../registry.ts";

export const adapter: Adapter = {
  protocol: "openai-completions",
  discover: openAICompletionsAdapter.discover,
  async chat(apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const b = body as Record<string, unknown>;
    const out: Record<string, unknown> = { ...b };
    delete out.store;
    if (b.reasoning_effort) {
      (out as Record<string, unknown>).thinking = { type: "enabled" };
    }
    return openAICompletionsAdapter.chat(apiKey, baseUrl, out, signal);
  },
};