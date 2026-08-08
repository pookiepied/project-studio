/**
 * AI Mode / Tier config — frontend fallback values only.
 *
 * The live tier→model mapping is fetched at runtime from GET /v1/modes
 * (ai/src/gateway/config/modes.ts). These values are used only when the
 * network is unavailable. To change which model a tier uses, edit the
 * backend config and redeploy the worker — no frontend change needed.
 *
 * AUTO_DISPLAY_MODEL mirrors AUTO_STATIC_MODEL from
 * ai/src/gateway/services/router/config.ts.
 */

export interface AIMode {
  id: string;
  label: string;
  description: string;
  /** Actual model ID sent to the API. For "auto", the gateway handles routing. */
  modelId: string;
  icon: "leaf" | "lightning" | "star" | "sparkle";
}

/** Sent to the API when the user picks Auto mode */
const AUTO_MODEL_ID = "auto";

/**
 * Model shown visually next to "Auto".
 * Mirrors AUTO_STATIC_MODEL in ai/src/gateway/services/router/config.ts.
 */
export const AUTO_DISPLAY_MODEL = "alibaba:qwen3.6-flash-2026-04-16";

export const AI_MODES: AIMode[] = [
  {
    id: AUTO_MODEL_ID,
    label: "Auto",
    description: "Smart routing for any conversation",
    modelId: AUTO_MODEL_ID,
    icon: "leaf",
  },
  {
    id: "fast",
    label: "Fast",
    description: "Mimo V2.5 · Instant replies",
    modelId: "openrouter:xiaomi/mimo-v2.5",
    icon: "lightning",
  },
  {
    id: "standard",
    label: "Standard",
    description: "Qwen 3.6 Plus · Balanced quality",
    modelId: "openrouter:qwen/qwen3.6-plus-04-02",
    icon: "star",
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "GLM 5.1 · Maximum capability",
    // Verify slug at openrouter.ai/models — search "glm 5.1" (Z.ai / ZhipuAI)
    modelId: "openrouter:thudm/glm-5.1",
    icon: "sparkle",
  },
];

/** Get tier by model ID or tier ID */
export function getAIMode(modelId: string): AIMode | undefined {
  return AI_MODES.find((m) => m.modelId === modelId || m.id === modelId);
}
