// Family rules for Mistral models. Mistral is OpenAI-wire-compatible. New models that match
// a naming pattern inherit these capabilities at "family" confidence (see ./reasoning.ts)
// until an exact review is added. Capabilities are gated PER MODEL (never blanket for the
// provider). Verified against the @ai-sdk/mistral v4 model list + Mistral docs (2026-07-05).

// Embedding models carry "embed" in the id (mistral-embed). Everything else that is not a
// moderation / OCR utility model is treated as a chat model.
export function isMistralEmbeddingModel(modelId: string): boolean {
  return /embed/i.test(modelId);
}

function isMistralUtilityModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes("moderation") || id.includes("ocr") || id.includes("voxtral") || id.includes("whisper");
}

// A Mistral chat model is any non-embedding, non-utility model. The known chat families are
// ministral-*, mistral-{large,medium,small,tiny,saba}-*, magistral-* (reasoning),
// pixtral-* (vision), codestral-* / devstral-* (code), open-mistral-* / open-mixtral-*.
export function isMistralChatModel(modelId: string): boolean {
  if (isMistralEmbeddingModel(modelId)) return false;
  if (isMistralUtilityModel(modelId)) return false;
  return /^(ministral|mistral|magistral|pixtral|codestral|devstral|open-mistral|open-mixtral)/i.test(modelId);
}

// Vision (image input) is supported on the Pixtral line and Mistral's recent multimodal
// medium/small releases. Older large/small text models and the code + Magistral lines are
// text-only. Conservative allow-list; unverified models default to text-only.
export function supportsMistralVision(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!isMistralChatModel(id)) return false;
  if (id.includes("pixtral")) return true;
  if (id.includes("medium-3") || id.includes("medium-2508") || id.includes("medium-2505")) return true;
  if (id.includes("small-2503") || id.includes("small-2506") || id.includes("small-2603")) return true;
  return false;
}

// Tool / function calling is supported across the Mistral chat lineup.
export function supportsMistralTools(modelId: string): boolean {
  return isMistralChatModel(modelId);
}

// Mistral supports structured outputs (`response_format: json_schema`) on its chat models
// via the structuredOutputs provider option. Enforced in ../chat.ts through the AI SDK's
// structured-output mechanism, the same as OpenAI/Groq.
export function supportsMistralJsonSchema(modelId: string): boolean {
  return isMistralChatModel(modelId);
}

// Mistral exposes NO client-side cache_control breakpoint API, so the gateway declares
// prompt caching unsupported (same stance as Groq/xAI/DeepSeek).
export function supportsMistralPromptCaching(_modelId: string): boolean {
  return false;
}

// Context windows. Codestral ships a 256K window; Magistral, large/medium/small and
// ministral are 128K. Legacy open-mistral/open-mixtral were 32K.
export function contextWindowForMistralModel(modelId: string): number {
  const id = modelId.toLowerCase();
  if (id.includes("codestral")) return 256_000;
  if (id.startsWith("open-mistral") || id.startsWith("open-mixtral")) return 32_000;
  return 128_000;
}

// Max output. Reasoning (Magistral) models emit long reasoning + answer streams; other chat
// models use a conservative 8K ceiling.
export function maxOutputForMistralModel(modelId: string): number {
  return /magistral/i.test(modelId) ? 40_960 : 8_192;
}
