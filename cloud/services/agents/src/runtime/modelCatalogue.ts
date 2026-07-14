/// <reference types="@cloudflare/workers-types" />

/**
 * Agent model catalogue — the curated set of models sub-agents may run on.
 *
 * WHY A CATALOGUE (not the full gateway list): the gateway discovers 500+ models
 * into MODELS_KV. Exposing that to the main agent is noise — it would have to
 * reason about model names it can't evaluate. Instead we curate a small set that
 * is specifically good at AGENT work (reliable tool-calling + reasoning/coding,
 * spread across a fast→deep cost curve) and group them into three tiers. The
 * main agent picks a TIER by intent; the agents worker resolves the tier to a
 * concrete model here.
 *
 * SELECTION LENS (why these and not the chat worker's user-facing modes): a
 * research sub-agent lives or dies by tool-calling — it loops web_search /
 * web_fetch / rag / http_request. Every entry below is a dependable tool-caller
 * with solid reasoning; we deliberately skip cheap generalist chat models that
 * are pleasant to talk to but weak at structured tool loops.
 *
 * SOURCE OF IDS: every "provider:model" here is already committed and in-use in
 * the gateway's own routing config (gateway/src/services/router/{config,modes}.ts),
 * so they are known-valid provider/model pairs the gateway can route today.
 *
 * RETUNING: this is the single place to add/swap a model. Tiers (modelTiers.ts)
 * are just views over this list, and every tier stays env-overridable so the set
 * can also be retuned per-environment without a redeploy.
 */

export type ModelTier = "quick" | "balanced" | "deep";

/** Ordered preference within a tier: primary is tried first, then fallback. */
export type ModelRole = "primary" | "fallback" | "alternate";

export interface AgentModel {
  /** "provider:model" exactly as the gateway expects it. */
  id:        string;
  /** Human-readable name for logs / UI / review. */
  label:     string;
  tier:      ModelTier;
  role:      ModelRole;
  /** Capability tags — the reason this model earns a slot. */
  strengths: string[];
  /** One-line rationale for the pick. */
  note:      string;
}

/**
 * The curated catalogue. Kept intentionally small (≈3 per tier). Order matters:
 * within each tier the entries are listed primary → fallback → alternate.
 */
export const MODEL_CATALOGUE: AgentModel[] = [
  // ── quick: fast + cheap, still a real tool-caller. Light tasks: quick
  //    lookups, single-source checks, short syntheses. ───────────────────────
  {
    id:        "groq:openai/gpt-oss-120b",
    label:     "GPT-OSS 120B (Groq)",
    tier:      "quick",
    role:      "primary",
    strengths: ["fast-inference", "tool-calling", "reasoning"],
    note:      "Groq-speed 120B with dependable tool-calling — ideal for light, high-throughput agent loops.",
  },
  {
    id:        "google:gemini-2.5-flash",
    label:     "Gemini 2.5 Flash",
    tier:      "quick",
    role:      "fallback",
    strengths: ["fast-inference", "long-context", "multimodal", "tool-calling"],
    note:      "Fast, ~1M context, multimodal — reads long fetched pages/PDFs without choking.",
  },
  {
    id:        "groq:llama-3.3-70b-versatile",
    label:     "Llama 3.3 70B (Groq)",
    tier:      "quick",
    role:      "alternate",
    strengths: ["fast-inference", "tool-calling"],
    note:      "Groq-fast, well-behaved tool-caller — a proven backup for the quick tier.",
  },

  // ── balanced: DEFAULT. Strong reasoning + coding at a sane cost — most
  //    real research runs. ─────────────────────────────────────────────────
  {
    id:        "openrouter:deepseek/deepseek-v3.2",
    label:     "DeepSeek V3.2",
    tier:      "balanced",
    role:      "primary",
    strengths: ["reasoning", "code", "tool-calling", "cost-efficient"],
    note:      "The research workhorse — strong reasoning/coding and tool use at low cost.",
  },
  {
    id:        "openrouter:qwen/qwen3.6-plus-04-02",
    label:     "Qwen 3.6 Plus",
    tier:      "balanced",
    role:      "fallback",
    strengths: ["reasoning", "tool-calling", "long-context"],
    note:      "Newest Qwen Plus (the chat worker's Standard mode) — balanced quality when DeepSeek is unavailable.",
  },
  {
    id:        "openrouter:minimax/minimax-m2.7",
    label:     "MiniMax M2.7",
    tier:      "balanced",
    role:      "alternate",
    strengths: ["reasoning", "tool-calling", "agentic"],
    note:      "Agentic model that holds up over long multi-tool loops.",
  },

  // ── deep: maximum capability. Hard multi-step reasoning, ambiguous topics,
  //    or when the main agent explicitly wants depth over cost. ─────────────
  {
    id:        "openrouter:qwen/qwen3-235b-a22b",
    label:     "Qwen3 235B A22B",
    tier:      "deep",
    role:      "primary",
    strengths: ["reasoning", "code", "tool-calling", "thinking"],
    note:      "235B MoE — top-tier multi-step reasoning for the hardest research.",
  },
  {
    id:        "openrouter:thudm/glm-5.1",
    label:     "GLM 5.1",
    tier:      "deep",
    role:      "fallback",
    strengths: ["reasoning", "code", "agentic", "tool-calling"],
    note:      "GLM 5.1 (the chat worker's Advanced/max-capability mode) — strong agentic coding.",
  },
  {
    id:        "alibaba:qwen3-max-preview",
    label:     "Qwen3 Max (preview)",
    tier:      "deep",
    role:      "alternate",
    strengths: ["reasoning", "long-context"],
    note:      "Large-context deep-reasoning safety net for the deep tier.",
  },
];

/** All catalogue entries for a tier, ordered primary → fallback → alternate. */
export function catalogueForTier(tier: ModelTier): AgentModel[] {
  const rank: Record<ModelRole, number> = { primary: 0, fallback: 1, alternate: 2 };
  return MODEL_CATALOGUE
    .filter((m) => m.tier === tier)
    .sort((a, b) => rank[a.role] - rank[b.role]);
}

/**
 * The default primary + fallback IDs for a tier, taken from the catalogue.
 * Throws if a tier somehow lacks a primary/fallback so a bad edit fails loudly.
 */
export function catalogueDefaults(tier: ModelTier): { primary: string; fallback: string } {
  const models = catalogueForTier(tier);
  const primary = models.find((m) => m.role === "primary") ?? models[0];
  if (!primary) throw new Error(`Model catalogue has no entry for tier "${tier}".`);
  const fallback = models.find((m) => m.role === "fallback") ?? models[1] ?? primary;
  return { primary: primary.id, fallback: fallback.id };
}
