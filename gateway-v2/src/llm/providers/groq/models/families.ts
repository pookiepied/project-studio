// Family rules for Groq models. Groq serves an OpenAI-wire-compatible mix of chat/text
// models (Llama, Qwen, GPT-OSS, Moonshot, DeepSeek, groq/compound), Whisper STT models,
// and Orpheus TTS models. New Groq models that match a naming pattern inherit these
// capabilities at "family" confidence (see ./reasoning.ts) until an exact review is added.
//
// Capabilities are gated PER MODEL here (never blanket for the provider): a Whisper model
// must not advertise chat/tools, and a TTS model must not advertise chat.

// Groq's internal safety / guard models are NOT user-facing chat models and are excluded
// from the catalog entirely (mirrors the old gateway's skip). Match every guard variant:
// llama-guard-*, meta-llama/llama-guard-*, prompt-guard, and gpt-oss-safeguard.
export function isGroqGuardModel(modelId: string): boolean {
  return /guard|safeguard/i.test(modelId);
}

export function isGroqTranscriptionModel(modelId: string): boolean {
  return /whisper/i.test(modelId);
}

export function isGroqSpeechModel(modelId: string): boolean {
  return /orpheus|playai|tts/i.test(modelId);
}

// A chat/text model is anything that is not a guard model, not STT, and not TTS.
export function isGroqChatModel(modelId: string): boolean {
  return !isGroqGuardModel(modelId) && !isGroqTranscriptionModel(modelId) && !isGroqSpeechModel(modelId);
}

// Vision (image input) is available only on the multimodal Llama 4 models (Scout/Maverick)
// and Qwen VL variants. Text-only Llama 3.x, Qwen3-32B, GPT-OSS, etc. do NOT accept images.
export function supportsGroqVision(modelId: string): boolean {
  return /llama-4|maverick|scout/i.test(modelId) || /qwen.*vl/i.test(modelId);
}

// Tool / function calling is supported across Groq's chat lineup (llama-*, mixtral-*,
// openai/gpt-oss-*, qwen/*, moonshotai/*, groq/compound*). Guard/STT/TTS models are not
// chat models and never reach here. Per Groq's tool-use docs.
export function supportsGroqTools(modelId: string): boolean {
  return isGroqChatModel(modelId);
}

// openai/gpt-oss-120b does NOT support parallel tool calls (Groq docs). Every other
// tool-capable model does. Enforced in ../chat.ts via providerOptions.groq.parallelToolCalls.
export function supportsGroqParallelTools(modelId: string): boolean {
  return !/gpt-oss-120b/i.test(modelId);
}

// Per Groq's structured-outputs docs, `response_format: json_schema` is supported ONLY on
// GPT-OSS (strict mode, via constrained decoding) and the Llama 4 models (best-effort). Every
// other chat model (Llama 3.x, Qwen3, Moonshot Kimi, groq/compound) supports only schemaless
// `json_object` mode — which the gateway does not gate — so they declare json_schema
// unsupported and validation rejects a json_schema request rather than letting Groq 400 it.
// Confirmed: https://console.groq.com/docs/structured-outputs (as of 2026-07-05).
export function supportsGroqJsonSchema(modelId: string): boolean {
  return /gpt-oss/i.test(modelId) || /llama-4|maverick|scout/i.test(modelId);
}

// Groq performs automatic prompt caching server-side but exposes NO cache_control breakpoint
// API the way OpenAI/Anthropic do, so the gateway declares prompt caching unsupported.
export function supportsGroqPromptCaching(_modelId: string): boolean {
  return false;
}

// The current Groq chat lineup this gateway seeds all run a 128K-token context window.
export function contextWindowForGroqModel(_modelId: string): number {
  return 131_072;
}

export function maxOutputForGroqModel(modelId: string): number {
  // GPT-OSS reasoning models emit long reasoning + answer streams and cap higher.
  return /gpt-oss/i.test(modelId) ? 65_536 : 32_768;
}
