/**
 * Provider quirks — single source of truth for OpenAI-compatible divergences.
 * Replaces 20 per-provider adapter folders. Each entry patches the OpenAI body
 * before proxying via the shared openai-completions fetch.
 *
 * Data sourced from ai-sdk provider docs + live testing.
 * When ai-sdk adds a fix, delete the quirk here.
 */

export type QuirkPatch = (body: Record<string, unknown>) => Record<string, unknown>;

function stripStore(b: Record<string, unknown>): void {
  delete b.store;
}

function stripStrict(tools: unknown): void {
  if (!Array.isArray(tools)) return;
  for (const t of tools as Array<Record<string, unknown>>) {
    const fn = t.function as Record<string, unknown> | undefined;
    if (fn && "strict" in fn) {
      const { strict: _s, ...rest } = fn;
      t.function = rest;
    }
  }
}

function mapMaxCompletionTokens(b: Record<string, unknown>): void {
  if (b.max_completion_tokens !== undefined && b.max_tokens === undefined) {
    b.max_tokens = b.max_completion_tokens;
    delete b.max_completion_tokens;
  }
}

// Each provider lists what to patch; undefined = passthrough (openai, fireworks, mistral, huggingface)
export const providerQuirks: Record<string, QuirkPatch> = {
  alibaba: (b) => {
    const out = { ...b };
    stripStore(out);
    mapMaxCompletionTokens(out);
    return out;
  },
  cerebras: (b) => {
    const out = { ...b };
    stripStore(out);
    if (b.reasoning_effort && !out.reasoning_format) (out as Record<string, unknown>).reasoning_format = "parsed";
    if (Array.isArray(out.tools)) stripStrict(out.tools);
    return out;
  },
  cohere: (b) => {
    const out = { ...b };
    delete out.parallel_tool_calls;
    stripStore(out);
    delete (out as Record<string, unknown>).metadata;
    if (out.reasoning_effort && !["none", "high"].includes(out.reasoning_effort as string)) out.reasoning_effort = "high";
    mapMaxCompletionTokens(out);
    if (Array.isArray(out.tools)) stripStrict(out.tools);
    return out;
  },
  deepseek: (b) => {
    const out = { ...b };
    stripStore(out);
    mapMaxCompletionTokens(out);
    if (b.reasoning_effort) (out as Record<string, unknown>).thinking = { type: "enabled" };
    return out;
  },
  groq: (b) => {
    const out = { ...b };
    if (typeof b.model === "string" && (b.model as string).includes("gpt-oss")) out.parallel_tool_calls = false;
    stripStore(out);
    if (Array.isArray(out.tools)) stripStrict(out.tools);
    return out;
  },
  minimax: (b) => {
    const out = { ...b };
    stripStore(out);
    return out;
  },
  moonshot: (b) => {
    const out = { ...b };
    stripStore(out);
    if (Array.isArray(out.tools)) stripStrict(out.tools);
    return out;
  },
  openrouter: (b) => {
    const out = { ...b };
    if (b.reasoning_effort) {
      (out as Record<string, unknown>).reasoning = { effort: b.reasoning_effort };
      delete out.reasoning_effort;
    }
    return out;
  },
  together: (b) => {
    const out = { ...b };
    stripStore(out);
    if (Array.isArray(out.tools)) stripStrict(out.tools);
    // together reasoning via reasoning.enabled handled upstream if present
    return out;
  },
  xiaomi: (b) => {
    const out = { ...b };
    stripStore(out);
    if (Array.isArray(out.tools)) stripStrict(out.tools);
    return out;
  },
  zai: (b) => {
    const out = { ...b };
    stripStore(out);
    mapMaxCompletionTokens(out);
    return out;
  },
  xai: (b) => {
    const out = { ...b };
    stripStore(out);
    return out;
  },
  huggingface: (b) => ({ ...b }),
  fireworks: (b) => ({ ...b }),
  mistral: (b) => ({ ...b }),
  alibaba_cn: (b) => {
    const out = { ...b };
    stripStore(out);
    mapMaxCompletionTokens(out);
    return out;
  },
  // elevenlabs / fal have non-chat modalities — keep passthrough for now, custom handlers handle images/audio
  elevenlabs: (b) => ({ ...b }),
  fal: (b) => ({ ...b }),
};

export function applyQuirk(providerId: string, body: Record<string, unknown>): Record<string, unknown> {
  const patch = providerQuirks[providerId];
  if (!patch) return { ...body };
  return patch(body);
}
