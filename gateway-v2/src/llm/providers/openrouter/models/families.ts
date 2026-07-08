import type { OpenRouterApiModel } from "./discovery";

// Capability derivation for OpenRouter models, read from the live /models metadata
// (architecture.input_modalities + supported_parameters). Capabilities are gated PER MODEL,
// never blanket for the provider. OpenRouter's supported_parameters is authoritative for the
// feature flags, so this is "live" confidence rather than a naming heuristic.

// A model is in-scope for the gateway if it is a CHAT model — i.e. it can output text.
// Pure image / audio / video / embedding models (output_modalities without "text") are
// excluded per the text+multimodal-only scope. When modalities are absent we assume text.
export function isOpenRouterChatModel(model: OpenRouterApiModel): boolean {
  const outputs = model.architecture?.output_modalities;
  if (!outputs || outputs.length === 0) return true;
  return outputs.includes("text");
}

// Vision = accepts image input. OpenRouter reports this in architecture.input_modalities.
export function supportsOpenRouterVision(model: OpenRouterApiModel): boolean {
  return Boolean(model.architecture?.input_modalities?.includes("image"));
}

// Tool / function calling is advertised via supported_parameters ("tools"/"tool_choice").
export function supportsOpenRouterTools(model: OpenRouterApiModel): boolean {
  return hasParam(model, "tools") || hasParam(model, "tool_choice");
}

// Structured outputs (response_format: json_schema) advertised via supported_parameters.
export function supportsOpenRouterJsonSchema(model: OpenRouterApiModel): boolean {
  return hasParam(model, "structured_outputs") || hasParam(model, "response_format");
}

// Reasoning models advertise "reasoning"/"include_reasoning"/"reasoning_effort".
export function supportsOpenRouterReasoning(model: OpenRouterApiModel): boolean {
  return hasParam(model, "reasoning") || hasParam(model, "include_reasoning") || hasParam(model, "reasoning_effort");
}

function hasParam(model: OpenRouterApiModel, param: string): boolean {
  return Boolean(model.supported_parameters?.includes(param));
}
