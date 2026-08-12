/**
 * openrouter adapter - reasoning via reasoning.effort
 */
import { openAICompletionsAdapter } from "../../adapters/openai-completions/adapter.ts";
import type { Adapter } from "../registry.ts";

export const adapter: Adapter = {
  protocol: "openai-completions",
  discover: openAICompletionsAdapter.discover,
  async chat(apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const b = body as Record<string, unknown>;
    const out: Record<string, unknown> = { ...b };
    if (b.reasoning_effort) {
      (out as Record<string, unknown>).reasoning = { effort: b.reasoning_effort };
      delete out.reasoning_effort;
    }
    return openAICompletionsAdapter.chat(apiKey, baseUrl, out, signal);
  },
};