/**
 * Popular provider allowlist — canonical location (was `catalog/popular.ts`).
 * The set shown enabled/loud in admin.
 * All 184 from models.dev are ingested but only these are enabled=1 by default.
 */

// Curated ~20 loud providers — enabled=1, rest 164 faded.
// Uses canonical runtime ids; `sync.ts` maps models.dev ids via MODELS_DEV_TO_REGISTRY.
export const POPULAR_PROVIDER_IDS = new Set<string>([
  "openai",
  "anthropic",
  "google",
  "alibaba",
  "deepseek",
  "groq",
  "mistral",
  "cerebras",
  "fireworks",
  "together",
  "cohere",
  "huggingface",
  "moonshot",
  "minimax",
  "xai",
  "zai",
  "xiaomi",
  "openrouter",
  "perplexity",
  "nvidia",
]);

// Registry → models.dev id (only where ids diverge). Self-maps omitted.
export const PROVIDER_ALIASES: Record<string, string> = {
  fireworks: "fireworks-ai",
  together: "togetherai",
  moonshot: "moonshotai",
};

// Reverse for ingest: models.dev id → registry id (e.g. fireworks-ai → fireworks)
export const MODELS_DEV_TO_REGISTRY: Record<string, string> = Object.fromEntries(
  Object.entries(PROVIDER_ALIASES).map(([k, v]) => [v, k]),
);
