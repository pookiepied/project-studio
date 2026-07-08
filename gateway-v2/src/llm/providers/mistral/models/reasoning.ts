import type { ReasoningEffort, ReasoningFeatures } from "../../../../core/capabilities";
import { isMistralChatModel } from "./families";

const REVIEWED_AT = "2026-07-05";

// Mistral's only reasoning models are the Magistral line. Reasoning is controlled by the
// @ai-sdk/mistral `reasoningEffort` provider option, whose schema is a binary
// 'none' | 'high' (confirmed against the installed @ai-sdk/mistral v4 chat-options schema).
// The gateway therefore exposes exactly ["none", "high"] for Magistral models; every other
// Mistral chat model declares reasoning unsupported.
const MAGISTRAL_EFFORTS: ReasoningEffort[] = ["none", "high"];

export function getReasoningForMistralModel(modelId: string): ReasoningFeatures {
  const id = modelId.toLowerCase();

  if (/magistral/i.test(id)) {
    return {
      supported: true,
      efforts: MAGISTRAL_EFFORTS,
      defaultEffort: "high",
      source: "official-docs",
      confidence: id === "magistral-medium-latest" || id === "magistral-small-latest" ? "exact" : "family",
      reviewedAt: REVIEWED_AT,
      note: "Magistral reasoning maps to the @ai-sdk/mistral reasoningEffort option (none|high)."
    };
  }

  // Non-Magistral Mistral chat models are not reasoning models.
  return {
    supported: false,
    efforts: [],
    source: isMistralChatModel(id) ? "official-docs" : "unknown",
    confidence: "exact",
    reviewedAt: REVIEWED_AT,
    note: "Only the Magistral line exposes reasoning controls; this model is a standard chat model."
  };
}
