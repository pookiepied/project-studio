/**
 * Groq adapter - OpenAI-compatible with Groq quirks
 * Groq gpt-oss models don't support parallel tool calls, no store, no strict
 */
import { openAICompletionsAdapter } from "../../adapters/openai-completions/adapter.ts";
import type { Adapter } from "../registry.ts";

export const adapter: Adapter = {
  protocol: "openai-completions",
  discover: openAICompletionsAdapter.discover,
  async chat(apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const b = body as Record<string, unknown>;
    const out: Record<string, unknown> = { ...b };
    // Groq gpt-oss models don't support parallel tool calls
    if (typeof b.model === "string" && (b.model as string).includes("gpt-oss")) {
      out.parallel_tool_calls = false;
    }
    // Groq does !support store
    delete out.store;
    // Groq does !support strict on tools
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
