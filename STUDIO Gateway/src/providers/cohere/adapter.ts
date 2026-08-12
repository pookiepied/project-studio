/**
 * cohere adapter - no parallel_tool_calls, reasoning only none|high, max_tokens
 */
import { openAICompletionsAdapter } from "../../adapters/openai-completions/adapter.ts";
import type { Adapter } from "../registry.ts";

export const adapter: Adapter = {
  protocol: "openai-completions",
  discover: openAICompletionsAdapter.discover,
  async chat(apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const b = body as Record<string, unknown>;
    const out: Record<string, unknown> = { ...b };
    delete out.parallel_tool_calls;
    delete out.store;
    delete (out as Record<string, unknown>).metadata;
    if (out.reasoning_effort && !["none","high"].includes(out.reasoning_effort as string)) {
      out.reasoning_effort = "high";
    }
    if (out.max_completion_tokens !== undefined && out.max_tokens === undefined) {
      out.max_tokens = out.max_completion_tokens;
      delete out.max_completion_tokens;
    }
    if (Array.isArray(out.tools)) {
      out.tools = (out.tools as Array<Record<string, unknown>>).map((t) => {
        const fn = t.function as Record<string, unknown> | undefined;
        if (fn && "strict" in fn) {
          const { strict: _s, ...rest } = fn;
          return { ...t, function: rest };
        }
        return t;
      });
    }
    return openAICompletionsAdapter.chat(apiKey, baseUrl, out, signal);
  },
};