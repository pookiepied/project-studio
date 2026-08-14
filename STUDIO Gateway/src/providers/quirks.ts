/**
 * Provider quirks — single source of truth for OpenAI-compatible divergences.
 * Adapter-level patches applied BEFORE AI SDK translation (not after).
 *
 * Canonical path: `providers/third-party/common.ts:thirdPartyChat` → `applyQuirk(id, body)`
 * → `normalizeMessagesForSDK` → `generateText/streamText`. This keeps one quirks table
 * for all 17 OpenAI-compatible providers and avoids per-provider adapter folders.
 *
 * Legacy path `adapters/router.ts:withProviderQuirk` is deprecated — new OpenAI-compatible
 * providers MUST use the SDK path above. Delete an entry when provider natively accepts
 * the canonical request.
 */

export type QuirkPatch = (body: Record<string, unknown>) => Record<string, unknown>;

function stripStore(b: Record<string, unknown>): void {
  delete b.store;
}

function stripStrict(tools: unknown): unknown {
  if (!Array.isArray(tools)) return tools;
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") return tool;
    const item = tool as Record<string, unknown>;
    const fn = item.function;
    if (!fn || typeof fn !== "object" || !("strict" in fn)) return { ...item };
    const { strict: _strict, ...rest } = fn as Record<string, unknown>;
    return { ...item, function: rest };
  });
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
    if (Array.isArray(out.tools)) out.tools = stripStrict(out.tools);
    return out;
  },
  cohere: (b) => {
    const out = { ...b };
    delete out.parallel_tool_calls;
    stripStore(out);
    delete (out as Record<string, unknown>).metadata;
    if (out.reasoning_effort && !["none", "high"].includes(out.reasoning_effort as string)) out.reasoning_effort = "high";
    mapMaxCompletionTokens(out);
    if (Array.isArray(out.tools)) out.tools = stripStrict(out.tools);
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
    if (Array.isArray(out.tools)) out.tools = stripStrict(out.tools);
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
    if (Array.isArray(out.tools)) out.tools = stripStrict(out.tools);
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
    if (Array.isArray(out.tools)) out.tools = stripStrict(out.tools);
    // together reasoning via reasoning.enabled handled upstream if present
    return out;
  },
  xiaomi: (b) => {
    const out = { ...b };
    stripStore(out);
    if (Array.isArray(out.tools)) out.tools = stripStrict(out.tools);
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
  nvidia: (b) => ({ ...b }),
  perplexity: (b) => ({ ...b }),
  // ElevenLabs/Fal use dedicated non-chat handlers; these are only defensive
  // passthroughs if a legacy chat call reaches this table.
  elevenlabs: (b) => ({ ...b }),
  fal: (b) => ({ ...b }),
};

export function applyQuirk(providerId: string, body: Record<string, unknown>): Record<string, unknown> {
  const patch = providerQuirks[providerId];
  if (!patch) return { ...body };
  return patch(body);
}
