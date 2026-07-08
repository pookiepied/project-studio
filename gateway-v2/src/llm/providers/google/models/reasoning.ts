import type { ReasoningEffort, ReasoningFeatures } from "../../../../core/capabilities";

const GOOGLE_THINKING_EFFORTS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high"];

export function getGoogleReasoningForModel(modelId: string): ReasoningFeatures {
  if (/gemini-(2\.5|3|3\.1|3\.5)/.test(modelId)) {
    return {
      supported: true,
      efforts: GOOGLE_THINKING_EFFORTS,
      defaultEffort: "medium",
      source: "family-rule",
      confidence: "family",
      note: "Mapped to Google thinkingConfig. Exact per-model thinking controls are not fully represented by /models."
    };
  }

  return {
    supported: false,
    efforts: [],
    source: "unknown",
    confidence: "unknown",
    note: "No reviewed Google thinking controls for this model."
  };
}

