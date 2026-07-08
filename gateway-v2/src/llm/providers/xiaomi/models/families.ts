// Family rules for Xiaomi MiMo chat models. MiMo's OpenAI-compatible /models list carries no
// capability hints, so capabilities are derived from id naming (family confidence). Gated PER
// MODEL, never blanket. Verified against Xiaomi MiMo's API docs (2026-07-06):
// https://mimo.mi.com/docs/en-US/api/chat/openai-api

// Vision (image input) — the MiMo-V2.5 line is documented as natively omni-modal
// (image/video/audio/text), so both the base and Pro tier accept image input.
export function supportsXiaomiVision(modelId: string): boolean {
  return modelId.toLowerCase().startsWith("mimo-v2.5") || modelId.toLowerCase().startsWith("mimo-v2-5");
}

// Tool / function calling is supported across the MiMo commercial chat lineup.
export function supportsXiaomiTools(_modelId: string): boolean {
  return true;
}

// MiMo chat models support structured outputs (response_format: json_schema) via the
// OpenAI-compatible surface. Enforced in ../chat.ts through the AI SDK's structured-output
// mechanism.
export function supportsXiaomiJsonSchema(_modelId: string): boolean {
  return true;
}
