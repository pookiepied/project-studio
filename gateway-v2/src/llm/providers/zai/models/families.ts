// Family rules for Z.AI (GLM) chat models. Z.AI's OpenAI-compatible /models list carries no
// capability hints, so capabilities are derived from id naming (family confidence). Gated PER
// MODEL, never blanket. Verified against Z.AI's developer docs (2026-07-06):
// https://docs.z.ai/guides/overview/quick-start

// Vision (image/video input) is the "v" line — currently GLM-5V-Turbo.
export function supportsZaiVision(modelId: string): boolean {
  return modelId.toLowerCase().includes("v-turbo") || modelId.toLowerCase().includes("v-flash");
}

// Tool / function calling is supported across the GLM commercial chat lineup.
export function supportsZaiTools(_modelId: string): boolean {
  return true;
}

// GLM chat models support structured outputs (response_format: json_schema) via the
// OpenAI-compatible surface. Enforced in ../chat.ts through the AI SDK's structured-output
// mechanism.
export function supportsZaiJsonSchema(_modelId: string): boolean {
  return true;
}

// Reasoning: GLM-5.x flagship/turbo models document an OpenAI-shaped `reasoning_effort`
// parameter (low/medium/high). The vision-coding line (v-turbo) and lightweight Flash tier
// are not documented as supporting it, so reasoning is scoped to the plain "glm-5*" line.
export function supportsZaiReasoning(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return /^glm-5(\.\d+)?(-turbo)?$/.test(id);
}
