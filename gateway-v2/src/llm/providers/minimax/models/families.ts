// Family rules for MiniMax chat models. MiniMax's OpenAI-compatible /models list carries no
// capability hints, so capabilities are derived from id naming (family confidence). Gated PER
// MODEL, never blanket. Verified against MiniMax's OpenAI-compatible API docs (2026-07-06):
// https://platform.minimax.io/docs/api-reference/text-openai-api

// Vision (image input) is documented as exclusive to MiniMax-M3.
export function supportsMinimaxVision(modelId: string): boolean {
  return modelId.toLowerCase().startsWith("minimax-m3");
}

// Tool / function calling is supported across the MiniMax commercial chat lineup.
export function supportsMinimaxTools(_modelId: string): boolean {
  return true;
}

// MiniMax chat models support structured outputs (response_format: json_schema) via the
// OpenAI-compatible surface. Enforced in ../chat.ts through the AI SDK's structured-output
// mechanism.
export function supportsMinimaxJsonSchema(_modelId: string): boolean {
  return true;
}
