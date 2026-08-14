/**
 * Anthropic types - mirrors GET /v1/models response
 * Based on SDK src/resources/models.ts ModelInfo and docs.anthropic.com models table
 */

export interface AnthropicModelCapabilities {
  batch: { supported: boolean };
  citations: { supported: boolean };
  code_execution: { supported: boolean };
  context_management: {
    clear_thinking_20251015: { supported: boolean } | null;
    clear_tool_uses_20250919: { supported: boolean } | null;
    compact_20260112: { supported: boolean } | null;
    supported: boolean;
  };
  effort: {
    supported: boolean;
    low: { supported: boolean };
    medium: { supported: boolean };
    high: { supported: boolean };
    max: { supported: boolean };
    xhigh: { supported: boolean } | null;
  };
  image_input: { supported: boolean };
  pdf_input: { supported: boolean };
  structured_outputs: { supported: boolean };
  thinking: {
    supported: boolean;
    types: {
      adaptive: { supported: boolean };
      enabled: { supported: boolean };
    };
  };
}

export interface AnthropicModelInfo {
  id: string;
  display_name: string;
  type: "model";
  created_at: string; // RFC3339
  max_input_tokens: number | null;
  max_tokens: number | null; // max output for sync API
  capabilities: AnthropicModelCapabilities | null;
}

// Pricing - not in models API, from docs.anthropic.com pricing table
export interface AnthropicPricing {
  input: number; // per 1M
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export const ANTHROPIC_PRICING: Record<string, AnthropicPricing> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
};

// For discovery mapping
export function inferReasoningType(caps: AnthropicModelCapabilities | null): {
  type: "none" | "dynamic" | "selected";
  levels: string[];
} {
  if (!caps) return { type: "none", levels: [] };
  const effort = caps.effort;
  const thinking = caps.thinking;
  if (thinking.types.adaptive.supported) {
    // Adaptive thinking = dynamic (always on, effort param controls)
    const levels: string[] = [];
    if (effort.low.supported) levels.push("low");
    if (effort.medium.supported) levels.push("medium");
    if (effort.high.supported) levels.push("high");
    if (effort.xhigh?.supported) levels.push("xhigh");
    if (effort.max.supported) levels.push("max");
    return { type: "dynamic", levels };
  }
  if (thinking.supported && thinking.types.enabled.supported) {
    // Extended thinking = selected with budget tokens
    return { type: "selected", levels: ["low", "medium", "high"] };
  }
  return { type: "none", levels: [] };
}
