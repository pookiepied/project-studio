// Family rules for Claude models. New Claude models that match a naming pattern
// inherit these capabilities at "family" confidence (see ./reasoning.ts) until an
// exact review is added.

export function isAnthropicChatModel(modelId: string): boolean {
  // Anthropic only serves chat/multimodal Claude models (no embeddings/audio/image).
  return modelId.startsWith("claude");
}

// All Claude 3+ models accept image input. The current lineup this gateway seeds is
// entirely Claude 3.5+/4/5, so vision is universally supported.
export function supportsAnthropicVision(_modelId: string): boolean {
  return true;
}

// All Claude 3+ models support tool use (function calling), including parallel tools.
export function supportsAnthropicTools(_modelId: string): boolean {
  return true;
}

// Claude does not expose a provider-enforced JSON-schema/structured-output mode the way
// OpenAI/Google do; structured output is achieved via tool use. Declare false so the
// gateway rejects `response_format: json_schema` rather than silently ignoring it.
export function supportsAnthropicJsonSchema(_modelId: string): boolean {
  return false;
}

// Prompt caching (cache_control breakpoints) is supported across Claude 3.5+/4/5.
export function supportsAnthropicPromptCaching(_modelId: string): boolean {
  return true;
}

// Models with a 1M-token context window (standard pricing, no long-context premium):
// Claude Opus 4.6+, Sonnet 5, Sonnet 4.6, and Fable 5. Older/legacy Claude models
// (Opus 4.5, Sonnet 4.5, Haiku 4.5) use a 200K window.
function isLongContextModel(modelId: string): boolean {
  return (
    /claude-opus-4-(?:[6-9]|\d{2,})/.test(modelId) ||
    /claude-sonnet-5/.test(modelId) ||
    /claude-sonnet-4-(?:[6-9]|\d{2,})/.test(modelId) ||
    /claude-(?:fable|mythos)-5/.test(modelId)
  );
}

export function contextWindowForAnthropicModel(modelId: string): number {
  return isLongContextModel(modelId) ? 1_000_000 : 200_000;
}

export function maxOutputForAnthropicModel(modelId: string): number {
  // 1M-context Claude 4.6+/5/Fable models cap at 128K output tokens; the 200K-window
  // legacy/Haiku models cap at 64K.
  return isLongContextModel(modelId) ? 128_000 : 64_000;
}
