// Family rules for Alibaba Model Studio (Qwen) chat models. DashScope's OpenAI-compatible
// /models list carries no capability hints, so capabilities are derived from id naming
// (family confidence). Gated PER MODEL, never blanket. Verified against Alibaba Model Studio
// model list (international / Singapore, 2026-07-06).

// Vision (image input) is the Qwen-VL / Qwen-Omni / QVQ multimodal lines.
export function supportsAlibabaVision(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes("-vl") || id.includes("vl-") || id.includes("omni") || id.startsWith("qvq");
}

// Tool / function calling is supported across the Qwen commercial chat lineup.
export function supportsAlibabaTools(_modelId: string): boolean {
  return true;
}

// Qwen chat models support structured outputs (response_format: json_schema) via the OpenAI-
// compatible surface. Enforced in ../chat.ts through the AI SDK's structured-output mechanism.
export function supportsAlibabaJsonSchema(_modelId: string): boolean {
  return true;
}
