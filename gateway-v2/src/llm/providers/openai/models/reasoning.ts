import type { ReasoningEffort, ReasoningFeatures } from "../../../../core/capabilities";

const REVIEWED_AT = "2026-07-05";

const GPT_5_DOT_FULL_EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];
const GPT_5_DOT_STANDARD_EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high"];
const GPT_5_BASE_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];
const O_SERIES_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];

const EXACT_REASONING: Record<string, ReasoningFeatures> = {
  "gpt-5.5": exactReasoning(GPT_5_DOT_FULL_EFFORTS, "medium"),
  "gpt-5.5-pro": exactReasoning(["high"], "high", "Reviewed as a pro reasoning model; keep exact metadata current."),
  "gpt-5.4": exactReasoning(GPT_5_DOT_FULL_EFFORTS, "medium"),
  "gpt-5.4-pro": exactReasoning(["high"], "high", "Reviewed as a pro reasoning model; keep exact metadata current."),
  "gpt-5.4-mini": exactReasoning(GPT_5_DOT_STANDARD_EFFORTS, "medium"),
  "gpt-5.4-nano": exactReasoning(GPT_5_DOT_STANDARD_EFFORTS, "medium"),
  "gpt-5.1": exactReasoning(GPT_5_DOT_STANDARD_EFFORTS, "none"),
  "gpt-5.1-chat-latest": exactReasoning(GPT_5_DOT_STANDARD_EFFORTS, "none"),
  "gpt-5": exactReasoning(GPT_5_BASE_EFFORTS, "medium"),
  "gpt-5-mini": exactReasoning(GPT_5_BASE_EFFORTS, "medium"),
  "gpt-5-nano": exactReasoning(["minimal", "low", "medium"], "medium")
};

export function getReasoningForOpenAIModel(modelId: string): ReasoningFeatures {
  const baseModelId = stripDateSuffix(modelId);
  const exact = EXACT_REASONING[modelId] ?? EXACT_REASONING[baseModelId];
  if (exact) return exact;

  const gpt5DotVersion = parseGpt5DotVersion(baseModelId);
  if (gpt5DotVersion && gpt5DotVersion >= 4) {
    return familyReasoning(
      GPT_5_DOT_FULL_EFFORTS,
      "medium",
      "Inferred for a newer GPT-5.x family. OpenAI /v1/models does not expose reasoning efforts; review when docs are updated."
    );
  }

  if (gpt5DotVersion && gpt5DotVersion >= 1) {
    return familyReasoning(
      GPT_5_DOT_STANDARD_EFFORTS,
      "medium",
      "Inferred for an older GPT-5.x family. Review before relying on xhigh support."
    );
  }

  if (/^gpt-5(?:-|$)/.test(baseModelId)) {
    return familyReasoning(
      GPT_5_BASE_EFFORTS,
      "medium",
      "Inferred for a GPT-5 base-family model. Date-pinned variants inherit the family profile until reviewed."
    );
  }

  if (/^(o\d|o4-mini)(?:-|$)/.test(baseModelId)) {
    return familyReasoning(
      O_SERIES_EFFORTS,
      "medium",
      "Inferred for an OpenAI o-series reasoning model. Review exact effort support per model."
    );
  }

  return reasoningUnsupported();
}

function exactReasoning(
  efforts: ReasoningEffort[],
  defaultEffort: ReasoningEffort,
  note = "Reviewed OpenAI reasoning metadata; /v1/models does not expose per-model reasoning effort values."
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

function familyReasoning(
  efforts: ReasoningEffort[],
  defaultEffort: ReasoningEffort,
  note: string
): ReasoningFeatures {
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
    note: "No reviewed OpenAI reasoning controls for this model."
  };
}

function parseGpt5DotVersion(modelId: string): number | undefined {
  const match = /^gpt-5\.(\d+)/.exec(modelId);
  return match ? Number(match[1]) : undefined;
}

function stripDateSuffix(modelId: string): string {
  return modelId.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

