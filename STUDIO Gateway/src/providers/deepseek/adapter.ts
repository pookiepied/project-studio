/**
 * deepseek adapter - thinking deepseek, max_tokens, requires reasoning_content
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
    if (out.max_completion_tokens !== undefined && out.max_tokens === undefined) {
      out.max_tokens = out.max_completion_tokens;
      delete out.max_completion_tokens;
    }
    if (b.reasoning_effort) {
      (out as Record<string, unknown>).thinking = { type: "enabled" };
    }
    return openAICompletionsAdapter.chat(apiKey, baseUrl, out, signal);
  },
};