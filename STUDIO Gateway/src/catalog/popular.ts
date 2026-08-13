/**
 * Popular provider allowlist — the set shown enabled/loud in admin.
 * All 184 from models.dev are ingested but only these are enabled=1 by default;
 * the rest are inserted enabled=0 (faded) so admin can opt-in per environment.
 *
 * Keep this list curated to ~25 diverse providers so first login isn't a wall
 * of 184 rows. Gateway still supports every provider; gating is purely admin UX.
 */

// Our curated 20 + 5 high-signal extras from models.dev top model counts.
// Must match `providerDefinitions` ids where overlap exists; extras use models.dev ids.
export const POPULAR_PROVIDER_IDS = new Set<string>([
  // core — kept from registry.ts:68
  "openai",
  "anthropic",
  "google",
  "alibaba",       // dashscope-intl
  "deepseek",
  "groq",
  "mistral",
  "cerebras",
  "fireworks-ai",  // was "fireworks" — models.dev id
  "togetherai",    // was "together"
  "cohere",
  "huggingface",
  "moonshotai",    // was "moonshot"
  "minimax",
  "xai",
  "zai",           // zhipuai alias — also ingested as "zhipuai"
  "xiaomi",
  "openrouter",
  "perplexity",
  "nvidia",
  "alibaba-cn",
  "zhipuai",
  "qwen", // via alibaba family, kept for search
]);

// Canonical alias map: our registry id → models.dev id (for sync)
export const PROVIDER_ALIASES: Record<string, string> = {
  fireworks: "fireworks-ai",
  together: "togetherai",
  moonshot: "moonshotai",
  zai: "zhipuai",
  alibaba: "alibaba", // dashscope-intl
};

// Reverse for ingest
export const MODELS_DEV_TO_REGISTRY: Record<string, string> = Object.fromEntries(
  Object.entries(PROVIDER_ALIASES).map(([k, v]) => [v, k]),
);
