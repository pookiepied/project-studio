/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";
import { type ModelTier, catalogueDefaults } from "./modelCatalogue";

/**
 * Agent-specific model tiers.
 *
 * These are DELIBERATELY separate from the chat worker's user-facing modes
 * (Fast / Standard / Advanced), which are tuned as generalist all-rounder
 * models for conversation. Agents do a different job — research, reasoning,
 * understanding structured sources — so the curated set (modelCatalogue.ts) is
 * chosen for that: dependable tool-callers with strong reasoning/coding.
 *
 * The main agent picks a tier by INTENT (or lets the default stand); the
 * agents worker resolves it to a concrete "provider:model" before calling the
 * gateway. This is why we never expose the full 500-model catalog — the tier
 * is the abstraction over it.
 *
 * Tier defaults come straight from the curated catalogue (modelCatalogue.ts),
 * which is the single source of truth for model IDs. Every tier is still
 * env-overridable (AGENT_TIER_<NAME>_PRIMARY/FALLBACK) so the set can be
 * retuned per-environment without a redeploy.
 */

export type { ModelTier } from "./modelCatalogue";

export interface ResolvedModel {
  /** Primary "provider:model" to try first. */
  model:    string;
  /** Fallback "provider:model" if the primary errors. */
  fallback: string;
}

interface TierPair {
  primary:  string;
  fallback: string;
}

const TIER_DEFAULTS: Record<ModelTier, TierPair> = {
  quick:    catalogueDefaults("quick"),
  balanced: catalogueDefaults("balanced"),
  deep:     catalogueDefaults("deep"),
};

/** Default tier when the caller does not specify one. */
export const DEFAULT_AGENT_TIER: ModelTier = "balanced";

const TIER_NAMES: ModelTier[] = ["quick", "balanced", "deep"];

function isTier(value: string): value is ModelTier {
  return (TIER_NAMES as string[]).includes(value);
}

/** Read a tier's models, applying env overrides (TIER_<NAME>_PRIMARY/FALLBACK). */
function getTier(tier: ModelTier, env: Env): TierPair {
  const upper = tier.toUpperCase();
  const d = TIER_DEFAULTS[tier];
  const vars = env as unknown as Record<string, unknown>;
  return {
    primary:  (vars[`AGENT_TIER_${upper}_PRIMARY`]  as string | undefined) ?? d.primary,
    fallback: (vars[`AGENT_TIER_${upper}_FALLBACK`] as string | undefined) ?? d.fallback,
  };
}

/**
 * Resolve a model spec passed by the main agent into a concrete model + fallback.
 *
 * Accepted spec forms:
 *   "quick" | "balanced" | "deep"  → the curated agent tier
 *   "inherit"                      → use the model the main agent is currently on
 *   "provider:model"               → explicit escape hatch (contains a colon)
 *   undefined / unknown            → DEFAULT_AGENT_TIER
 *
 * `inheritModel` is the caller's current model, forwarded at spawn time so a
 * sub-agent can transparently run on whatever the user selected.
 */
export function resolveAgentModel(
  spec:         string | undefined,
  env:          Env,
  inheritModel?: string,
): ResolvedModel {
  // Explicit "provider:model" — pass straight through.
  if (spec && spec.includes(":")) {
    const bal = getTier("balanced", env);
    return { model: spec, fallback: bal.primary };
  }

  // Inherit the caller's current model.
  if (spec === "inherit") {
    const bal = getTier("balanced", env);
    if (inheritModel && inheritModel.includes(":")) {
      return { model: inheritModel, fallback: bal.primary };
    }
    return { model: bal.primary, fallback: bal.fallback };
  }

  // Named tier, or fall back to the default tier.
  const tier = spec && isTier(spec) ? spec : DEFAULT_AGENT_TIER;
  const pair = getTier(tier, env);
  return { model: pair.primary, fallback: pair.fallback };
}
