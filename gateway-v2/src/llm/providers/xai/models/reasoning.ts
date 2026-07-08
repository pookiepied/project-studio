import type { ReasoningEffort, ReasoningFeatures } from "../../../../core/capabilities";

const REVIEWED_AT = "2026-07-05";

// xAI exposes reasoning on Grok reasoning-capable models, controlled via the @ai-sdk/xai
// `reasoningEffort` provider option (mapped onto the gateway ReasoningEffort scale). The
// installed @ai-sdk/xai (v3) chat-options schema only accepts the values
// `none | low | medium | high` — `xhigh` and `minimal` are NOT expressible through the
// SDK chat path, so no Grok model advertises them. ../chat.ts maps the gateway effort
// straight through to providerOptions.xai.reasoningEffort.
//
// Confirmed against https://docs.x.ai/docs/guides/reasoning (as of REVIEWED_AT):
//   • grok-4.3: reasoning.effort none (default off) | low (default) | medium | high.
//     "none" requires grok-4.3 or newer.
//   • grok-4.20-multi-agent: reasoning.effort low | medium | high | xhigh — but effort
//     controls the AGENT COUNT, not reasoning depth; xhigh is not expressible via the
//     SDK chat options, so only low/medium/high are advertised.
const GROK_FULL_EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high"];
const GROK_REASONING_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];

// "exact" = a specific model whose reasoning controls were verified against xAI's docs.
// Everything else falls back to a family rule below and is tagged "family".
// Only grok-4.3 and grok-4.20-multi-agent are explicitly named in the xAI reasoning doc's
// summary table; the grok-4.20-0309-reasoning variant is inferred by naming (family), and
// the grok-4.20-0309-non-reasoning variant is NOT a reasoning model.
const EXACT_REASONING: Record<string, ReasoningFeatures> = {
  "grok-4.3": exactReasoning(
    GROK_FULL_EFFORTS,
    "low",
    "grok-4.3 supports reasoning.effort none|low|medium|high; default is low."
  ),
  "grok-4.20-multi-agent-0309": exactReasoning(
    GROK_REASONING_EFFORTS,
    "low",
    "Multi-agent model: effort controls agent count, not reasoning depth. Native xhigh is not expressible via the SDK chat reasoningEffort option."
  )
};

export function getReasoningForXaiModel(modelId: string): ReasoningFeatures {
  const baseModelId = stripDateSuffix(modelId);
  const exact = EXACT_REASONING[modelId] ?? EXACT_REASONING[baseModelId];
  if (exact) return exact;

  // The "non-reasoning" variants are explicitly NOT reasoning models — guard BEFORE the
  // "-reasoning" family rule, which would otherwise match "non-reasoning" as a substring.
  if (/non-reasoning/i.test(baseModelId)) {
    return reasoningUnsupported();
  }

  // Family rules — inferred from the naming pattern; review before relying on exact effort support.
  if (/multi-agent/i.test(baseModelId)) {
    return familyReasoning(
      GROK_REASONING_EFFORTS,
      "low",
      "Inferred for a Grok multi-agent model. Effort controls agent count; native xhigh is not expressible via the SDK chat reasoningEffort option."
    );
  }

  if (/^grok-4\.3(?:-|$)/i.test(baseModelId)) {
    return familyReasoning(
      GROK_FULL_EFFORTS,
      "low",
      "Inferred for a grok-4.3 family model. Supports effort none|low|medium|high."
    );
  }

  if (/-reasoning/i.test(baseModelId)) {
    return familyReasoning(
      GROK_REASONING_EFFORTS,
      "low",
      "Inferred for a Grok reasoning variant. 'none' support is unverified (requires grok-4.3 or newer)."
    );
  }

  if (/grok-3-mini/i.test(baseModelId)) {
    return familyReasoning(
      GROK_REASONING_EFFORTS,
      "low",
      "Inferred for grok-3-mini reasoning. xAI /v1/models does not expose per-model reasoning effort values."
    );
  }

  // grok-3, grok-4 non-reasoning variants, code/build models, and legacy grok-beta are
  // not reasoning models.
  return reasoningUnsupported();
}

function exactReasoning(
  efforts: ReasoningEffort[],
  defaultEffort: ReasoningEffort,
  note = "Reviewed against xAI reasoning docs; gateway effort maps to the @ai-sdk/xai reasoningEffort option."
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
    note: "No reviewed xAI reasoning controls for this model."
  };
}

function stripDateSuffix(modelId: string): string {
  return modelId.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}
