import type { ReasoningEffort, ReasoningFeatures } from "../../../../core/capabilities";

const REVIEWED_AT = "2026-07-05";

// Claude extended-thinking models. The gateway ReasoningEffort scale is mapped to
// Anthropic's extended-thinking `budget_tokens` in ../chat.ts (toAnthropicThinking).
// The newest tiers (Opus 4.7/4.8, Sonnet 5, Fable 5) additionally expose an "xhigh"
// depth; older thinking models stop at "high".
const FULL_EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];
const STANDARD_EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high"];

// "exact" = a specific model whose extended-thinking behaviour was verified against
// Anthropic's model docs (as of REVIEWED_AT). Everything else falls back to a family
// rule below and is tagged "family".
const EXACT_REASONING: Record<string, ReasoningFeatures> = {
  "claude-opus-4-8": exactReasoning(FULL_EFFORTS, "medium"),
  "claude-opus-4-7": exactReasoning(FULL_EFFORTS, "medium"),
  "claude-sonnet-5": exactReasoning(FULL_EFFORTS, "medium"),
  "claude-fable-5": exactReasoning(FULL_EFFORTS, "medium"),
  "claude-sonnet-4-5": exactReasoning(STANDARD_EFFORTS, "medium"),
  "claude-opus-4-5": exactReasoning(STANDARD_EFFORTS, "medium")
};

export function getReasoningForAnthropicModel(modelId: string): ReasoningFeatures {
  const baseModelId = stripDateSuffix(modelId);
  const exact = EXACT_REASONING[modelId] ?? EXACT_REASONING[baseModelId];
  if (exact) return exact;

  // Family rules — inferred from the naming pattern, review before relying on exact
  // effort support.
  if (/claude-(?:opus|sonnet)-4-(?:[6-9]|\d{2,})/.test(baseModelId) || /claude-(?:opus|sonnet)-5/.test(baseModelId)) {
    return familyReasoning(
      FULL_EFFORTS,
      "medium",
      "Inferred for a newer Claude 4.6+/5 model. Mapped to Anthropic extended thinking; review exact effort support."
    );
  }

  if (/claude-(?:opus|sonnet)-4/.test(baseModelId) || /claude-(?:fable|mythos)-5/.test(baseModelId)) {
    return familyReasoning(
      STANDARD_EFFORTS,
      "medium",
      "Inferred for a Claude 4.x / Fable-family model with extended thinking. Review before relying on xhigh."
    );
  }

  if (/claude-3-7-sonnet/.test(baseModelId)) {
    return familyReasoning(
      STANDARD_EFFORTS,
      "medium",
      "Claude 3.7 Sonnet is a hybrid-reasoning model; extended thinking via budget_tokens."
    );
  }

  // Haiku, Claude 3.5, and Claude 3 Opus do not support extended thinking.
  return reasoningUnsupported();
}

function exactReasoning(
  efforts: ReasoningEffort[],
  defaultEffort: ReasoningEffort,
  note = "Reviewed against Anthropic model docs; gateway effort maps to extended-thinking budget_tokens."
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
    note: "No reviewed Anthropic extended-thinking support for this model."
  };
}

function stripDateSuffix(modelId: string): string {
  return modelId.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
}
