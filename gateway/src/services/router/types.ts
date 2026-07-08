/**
 * Auto-routing types.
 */

export type Tier = "simple" | "standard" | "complex" | "advanced" | "extreme";

export interface TierModelConfig {
  primary: string;
  fallback: string;
}

export interface RouterDecision {
  tier: Tier;
  model: string;
  usedFallback: boolean;
  usedEmergency: boolean;
}

export interface ClassifyInput {
  messages: Array<{ role: string; content?: unknown; tool_calls?: unknown }>;
}

export interface ProviderBudget {
  provider: string;
  dailyLimit: number;
  kvPrefix: string;
}
