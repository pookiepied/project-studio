import type { ReasoningEffort, ReasoningFeatures } from "../../../../core/capabilities";

const REVIEWED_AT = "2026-07-05";

// DeepSeek exposes reasoning via two @ai-sdk/deepseek provider options (confirmed against
// the installed @ai-sdk/deepseek v3 chat-options schema):
//   • providerOptions.deepseek.thinking: { type: 'adaptive' | 'enabled' | 'disabled' }
//   • providerOptions.deepseek.reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
// The gateway ReasoningEffort scale maps: minimal→low, none→disabled, low/medium/high
// pass through, xhigh passes through, max is not in the gateway scale.
//
// Confirmed against https://api-docs.deepseek.com/quick_start/pricing and
// https://api-docs.deepseek.com/guides/thinking_mode (as of REVIEWED_AT):
//   • deepseek-v4-flash / deepseek-v4-pro: support both thinking (default on) and
//     reasoning_effort low|medium|high|xhigh|max.
//   • deepseek-reasoner (legacy, deprecated 2026/07/24): always-on reasoning; reasoning
//     effort is inferred from the V4-family pattern.
const V4_FULL_EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];
const REASONER_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];

// "exact" = a specific model whose reasoning controls were verified against DeepSeek's docs.
// Everything else falls back to a family rule below and is tagged "family".
const EXACT_REASONING: Record<string, ReasoningFeatures> = {
  "deepseek-v4-flash": exactReasoning(
    V4_FULL_EFFORTS,
    "medium",
    "deepseek-v4-flash supports thinking (adaptive/enabled/disabled) + reasoning_effort low|medium|high|xhigh|max. Default thinking is enabled."
  ),
  "deepseek-v4-pro": exactReasoning(
    V4_FULL_EFFORTS,
    "medium",
    "deepseek-v4-pro supports thinking (adaptive/enabled/disabled) + reasoning_effort low|medium|high|xhigh|max. Default thinking is enabled."
  )
};

export function getReasoningForDeepSeekModel(modelId: string): ReasoningFeatures {
  const baseModelId = stripDateSuffix(modelId);
  const exact = EXACT_REASONING[modelId] ?? EXACT_REASONING[baseModelId];
  if (exact) return exact;

  // Family rules — inferred from the naming pattern; review before relying on exact effort support.
  if (/deepseek-v4/i.test(baseModelId)) {
    return familyReasoning(
      V4_FULL_EFFORTS,
      "medium",
      "Inferred for a deepseek-v4 family model. Supports thinking + reasoning_effort low|medium|high|xhigh|max."
    );
  }

  if (/deepseek-reasoner|deepseek-r1/i.test(baseModelId)) {
    return familyReasoning(
      REASONER_EFFORTS,
      "medium",
      "Inferred for a DeepSeek reasoner/R1 model. Always-on reasoning; reasoning_effort low|medium|high inferred from the V4 family."
    );
  }

  if (/deepseek-chat/i.test(baseModelId)) {
    return familyReasoning(
      V4_FULL_EFFORTS,
      "medium",
      "Inferred for deepseek-chat (alias of v4-flash non-thinking mode). Thinking can be enabled via provider option."
    );
  }

  // Unknown DeepSeek models: conservatively support reasoning (the platform default) but
  // tag the confidence "unknown" so a review is triggered.
  return {
    supported: true,
    efforts: REASONER_EFFORTS,
    defaultEffort: "medium",
    source: "family-rule",
    confidence: "unknown",
    note: "Conservative reasoning fallback for an unrecognized DeepSeek model. Review before relying on exact effort support."
  };
}

function exactReasoning(
  efforts: ReasoningEffort[],
  defaultEffort: ReasoningEffort,
  note = "Reviewed against DeepSeek reasoning docs; gateway effort maps to the @ai-sdk/deepseek reasoningEffort option."
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

function stripDateSuffix(modelId: string): string {
  return modelId.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}
