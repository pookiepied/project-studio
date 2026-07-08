// Family rules for DeepSeek models. DeepSeek is OpenAI-wire-compatible. New DeepSeek
// models that match a naming pattern inherit these capabilities at "family" confidence
// (see ./reasoning.ts) until an exact review is added.
//
// Capabilities are gated PER MODEL here (never blanket for the provider). Verified
// against the live DeepSeek API docs as of 2026-07-05:
//   - Vision (image input): NOT supported. DeepSeek's current V4 lineup (deepseek-v4-flash
//     / deepseek-v4-pro) is text-only. The AI SDK capabilities table confirms no image
//     input. https://api-docs.deepseek.com/quick_start/pricing
//   - Tools / function calling: supported on both V4 models.
//   - Reasoning: controlled via `thinking` + `reasoningEffort` provider options on
//     reasoning-capable models; see ./reasoning.ts.
//   - JSON output: supported (json_object + json_schema).
//   - Context caching: server-side disk cache (cache hit/miss reported in usage), but no
//     client cache_control breakpoint — declared unsupported.

// DeepSeek's documented model IDs are all "deepseek-*". The V4 lineup is
// deepseek-v4-flash / deepseek-v4-pro; the legacy deepseek-chat / deepseek-reasoner
// aliases remain (deprecated 2026/07/24). Anything else is not a DeepSeek chat model.
export function isDeepSeekChatModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!id.startsWith("deepseek-")) return false;
  return true;
}

// Vision (image input) is NOT supported on any current DeepSeek model. The V4 models are
// text-only. Keeping the function for parity with the other providers' family rules so
// the gateway enforces "vision → DeepSeek" as a clean CAPABILITY_NOT_SUPPORTED reject.
export function supportsDeepSeekVision(_modelId: string): boolean {
  return false;
}

// Tool / function calling is supported across the DeepSeek V4 lineup. Per DeepSeek's
// tool-calls docs (https://api-docs.deepseek.com/guides/tool_calls).
export function supportsDeepSeekTools(modelId: string): boolean {
  return isDeepSeekChatModel(modelId);
}

// DeepSeek supports JSON output (json_object) and json_schema on its chat models.
// Per https://api-docs.deepseek.com/guides/json_mode.
export function supportsDeepSeekJsonSchema(modelId: string): boolean {
  return isDeepSeekChatModel(modelId);
}

// DeepSeek performs automatic context caching server-side (disk cache) and reports
// cache hit/miss token counts, but exposes NO client cache_control breakpoint API the
// way OpenAI/Anthropic do, so the gateway declares prompt caching unsupported (same
// stance as Groq/xAI).
export function supportsDeepSeekPromptCaching(_modelId: string): boolean {
  return false;
}

// Context windows. The current V4 lineup ships a 1M-token context window
// (https://api-docs.deepseek.com/quick_start/pricing). Legacy V3/R1 were 64K.
export function contextWindowForDeepSeekModel(modelId: string): number {
  const id = modelId.toLowerCase();
  if (id.includes("v4")) return 1_000_000;
  if (id.includes("deepseek-chat")) return 1_000_000;
  return 64_000;
}

// Max output. The V4 lineup supports up to 384K output tokens; reasoning models emit long
// reasoning + answer streams. Legacy V3 was 8K, R1 was 32K.
export function maxOutputForDeepSeekModel(modelId: string): number {
  const id = modelId.toLowerCase();
  if (id.includes("v4")) return 384_000;
  if (id.includes("deepseek-reasoner") || id.includes("deepseek-r1")) return 32_768;
  return 8_192;
}

// Reasoning-capable DeepSeek models are: the V4 models (thinking mode, default on), the
// legacy deepseek-reasoner / deepseek-r1. The non-thinking deepseek-chat alias maps to
// the non-thinking mode of v4-flash and is still reasoning-capable via the `thinking`
// provider option. Mirrors the gating note in ./reasoning.ts.
export function supportsDeepSeekReasoningVariant(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!isDeepSeekChatModel(id)) return false;
  // All current DeepSeek models support the thinking provider option (thinking mode can
  // be enabled/disabled/adaptive). Legacy R1 / reasoner are always-on reasoning.
  return true;
}
