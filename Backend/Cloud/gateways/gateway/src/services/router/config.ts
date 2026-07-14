/**
 * Auto-router configuration.
 *
 * Tier model assignments and provider budgets.
 * AUTO_MODE = "static" — everyone gets AUTO_STATIC_MODEL (no classifier).
 * AUTO_MODE = "dynamic" — classifier runs, picks tier, checks budgets.
 */

import type { GatewayEnv }                    from "../../env";
import { Tier, TierModelConfig, ProviderBudget } from "./types";

export const AUTO_MODE: "static" | "dynamic" = "static";

const DEFAULTS = {
  AUTO_STATIC_MODEL: "alibaba:qwen3-max-preview",
  SIMPLE_PRIMARY:    "groq:openai/gpt-oss-120b",
  SIMPLE_FALLBACK:   "groq:llama-3.3-70b-versatile",
  STANDARD_PRIMARY:  "google:gemini-2.5-flash",
  STANDARD_FALLBACK: "google:gemini-2.5-flash-lite",
  COMPLEX_PRIMARY:   "openrouter:minimax/minimax-m2.5:free",
  COMPLEX_FALLBACK:  "openrouter:openai/gpt-oss-120b:free",
  ADVANCED_PRIMARY:  "openrouter:deepseek/deepseek-v3.2",
  ADVANCED_FALLBACK: "openrouter:minimax/minimax-m2.7",
  EXTREME_PRIMARY:   "openrouter:qwen/qwen3-235b-a22b",
  EXTREME_FALLBACK:  "openrouter:deepseek/deepseek-v3.2",
  EMERGENCY:         "openrouter:deepseek/deepseek-v3.2",
};

export function getAutoStaticModel(env?: GatewayEnv): string {
  return env?.AUTO_STATIC_MODEL_OVERRIDE ?? DEFAULTS.AUTO_STATIC_MODEL;
}

export function getTierConfig(env?: GatewayEnv): Record<Tier, TierModelConfig> {
  return {
    simple:   { primary: env?.TIER_SIMPLE_PRIMARY   ?? DEFAULTS.SIMPLE_PRIMARY,   fallback: env?.TIER_SIMPLE_FALLBACK   ?? DEFAULTS.SIMPLE_FALLBACK   },
    standard: { primary: env?.TIER_STANDARD_PRIMARY ?? DEFAULTS.STANDARD_PRIMARY, fallback: env?.TIER_STANDARD_FALLBACK ?? DEFAULTS.STANDARD_FALLBACK },
    complex:  { primary: env?.TIER_COMPLEX_PRIMARY  ?? DEFAULTS.COMPLEX_PRIMARY,  fallback: env?.TIER_COMPLEX_FALLBACK  ?? DEFAULTS.COMPLEX_FALLBACK  },
    advanced: { primary: env?.TIER_ADVANCED_PRIMARY ?? DEFAULTS.ADVANCED_PRIMARY, fallback: env?.TIER_ADVANCED_FALLBACK ?? DEFAULTS.ADVANCED_FALLBACK },
    extreme:  { primary: env?.TIER_EXTREME_PRIMARY  ?? DEFAULTS.EXTREME_PRIMARY,  fallback: env?.TIER_EXTREME_FALLBACK  ?? DEFAULTS.EXTREME_FALLBACK  },
  };
}

export function getEmergencyFallback(env?: GatewayEnv): string {
  return env?.EMERGENCY_FALLBACK_MODEL ?? DEFAULTS.EMERGENCY;
}

export const PROVIDER_BUDGETS: ProviderBudget[] = [
  { provider: "google", dailyLimit: 5000, kvPrefix: "rate:google" },
];

export const TOOL_ROUNDS_COMPLEX_THRESHOLD   = 2;
export const TOOL_ROUNDS_ADVANCED_THRESHOLD  = 6;
export const CONTEXT_TOKENS_ADVANCED_THRESHOLD = 12000;
export const CONTEXT_TOKENS_EXTREME_THRESHOLD  = 40000;

export const STANDARD_FLOOR_KEYWORDS = [
  "code", "write", "implement", "build", "create", "fix", "debug",
  "explain", "analyze", "analyse", "compare", "summarize", "summarise",
  "translate", "convert", "refactor", "review", "generate", "design",
  "help me", "how do i", "how to",
];
