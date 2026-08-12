/**
 * together adapter - reasoning via reasoning.enabled, no store, no strict
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
      (out as Record<string, unknown>).reasoning = { enabled: true };
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