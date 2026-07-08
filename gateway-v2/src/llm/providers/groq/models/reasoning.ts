import type { ReasoningEffort, ReasoningFeatures } from "../../../../core/capabilities";

const REVIEWED_AT = "2026-07-05";

// Groq exposes reasoning on two model families, controlled differently by the raw API but
// unified here onto the gateway ReasoningEffort scale. ../chat.ts maps these gateway efforts
// onto the @ai-sdk/groq `reasoningEffort` provider option:
//
//   • GPT-OSS (openai/gpt-oss-20b / -120b): accepts reasoning_effort low | medium | high.
//   • Qwen3 reasoning models: accept reasoning_effort none | default (on/off). The gateway's
//     low/medium/high all collapse to Groq "default" in chat.ts; "none" disables reasoning.
//
// Confirmed against https://console.groq.com/docs/reasoning (as of REVIEWED_AT).
const GPT_OSS_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];
const QWEN_EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high"];

// "exact" = a specific model whose reasoning controls were verified against Groq's docs.
// Everything else falls back to a family rule below and is tagged "family".
const EXACT_REASONING: Record<string, ReasoningFeatures> = {
  "openai/gpt-oss-120b": exactReasoning(GPT_OSS_EFFORTS, "medium"),
  "openai/gpt-oss-20b": exactReasoning(GPT_OSS_EFFORTS, "medium"),
  "qwen/qwen3-32b": exactReasoning(QWEN_EFFORTS, "medium", "Qwen3 reasoning is on/off; gateway efforts >none map to Groq 'default'."),
  "qwen/qwen3.6-27b": exactReasoning(QWEN_EFFORTS, "medium", "Qwen3 reasoning is on/off; gateway efforts >none map to Groq 'default'.")
};

export function getReasoningForGroqModel(modelId: string): ReasoningFeatures {
  const exact = EXACT_REASONING[modelId];
  if (exact) return exact;

  // Family rules — inferred from the naming pattern, review before relying on exact effort support.
  if (/gpt-oss/i.test(modelId)) {
    return familyReasoning(
      GPT_OSS_EFFORTS,
      "medium",
      "Inferred for a GPT-OSS reasoning model. Groq controls depth via reasoning_effort low/medium/high."
    );
  }

  if (/qwen3/i.test(modelId) || /qwq/i.test(modelId) || /deepseek-r1/i.test(modelId)) {
    return familyReasoning(
      QWEN_EFFORTS,
      "medium",
      "Inferred for a Qwen3/QwQ/DeepSeek-R1 reasoning model. Reasoning is on/off; efforts >none map to Groq 'default'."
    );
  }

  // Llama 3.x/4, Moonshot Kimi, groq/compound, Whisper and Orpheus are not reasoning models.
  return reasoningUnsupported();
}

function exactReasoning(
  efforts: ReasoningEffort[],
  defaultEffort: ReasoningEffort,
  note = "Reviewed against Groq reasoning docs; gateway effort maps to Groq reasoning_effort."
): ReasoningFeatures {
  return {
    supported: true,
    efforts,
    defaultEffort,
    source: "official-docs",
    confidence: "exact",
    reviewedAt: REVIEWED_AT,
    note
  };
}

function familyReasoning(efforts: ReasoningEffort[], defaultEffort: ReasoningEffort, note: string): ReasoningFeatures {
  return {
    supported: true,
    efforts,
    defaultEffort,
    source: "family-rule",
    confidence: "family",
    note
  };
}

function reasoningUnsupported(): ReasoningFeatures {
  return {
    supported: false,
    efforts: [],
    source: "unknown",
    confidence: "unknown",
    note: "No reviewed Groq reasoning controls for this model."
  };
}
