/// <reference types="@cloudflare/workers-types" />

export interface Env {
  // Cloudflare bindings
  MCP_OBJECT: DurableObjectNamespace;
  MEMORY_DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  PROFILE_KV: KVNamespace;

  // Tunable via wrangler.toml [vars] — change without code modification or redeploy
  EXTRACT_MODEL: string;
  EMBED_MODEL: string;
  INJECT_TOKEN_BUDGET: string;
  INJECT_RECENT_COUNT: string;
  INJECT_SEMANTIC_COUNT: string;

  // AI Worker — routes extraction LLM calls through your own gateway.
  // All 500+ models across all providers are available via this binding.
  AI_WORKER: Fetcher;

  // Secrets (set via: wrangler secret put <NAME>)
  MEMORY_AUTH_SECRET?: string;  // service-to-service bearer token (optional in dev)

  // Optional Studio integrations
  TRACKER?: Fetcher;
  ENVIRONMENT?: string;
}
