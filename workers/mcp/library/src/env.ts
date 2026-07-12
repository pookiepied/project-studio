/// <reference types="@cloudflare/workers-types" />

// Merged Env for studio-mcp-library. Combines the bindings previously split
// across studio-mcp-tools and studio-mcp-memory. Each category subfolder
// still declares its own narrower Env type (tools/studio-tools/env.ts,
// services/studio-memory/env.ts) for internal use — this is the superset
// the top-level router and wrangler.toml bindings target.
export interface Env {
  ENVIRONMENT?: string;

  // ── Durable Objects — one binding per MCP server class ─────────────────
  TOOLS_OBJECT: DurableObjectNamespace;
  MEMORY_OBJECT: DurableObjectNamespace;

  // ── studio-tools bindings ───────────────────────────────────────────────
  GATEWAY?: Fetcher; // studio-gateway — image/video generation
  IMAGES_BUCKET?:     R2Bucket;
  PUBLIC_IMAGE_BASE?: string;
  RAG_VECTORIZE?: VectorizeIndex; // studio-rag (768-dim, @cf/baai/bge-base-en-v1.5)
  MCP_KV?:    KVNamespace;        // rag TOC cache (shared namespace with chat)
  TAVILY_API_KEY?:       string;
  BRAVE_SEARCH_API_KEY?: string;
  TOOLS_AUTH_SECRET?: string;

  // ── studio-memory bindings ──────────────────────────────────────────────
  MEMORY_DB: D1Database;
  MEMORY_VECTORIZE: VectorizeIndex;
  PROFILE_KV: KVNamespace;
  EXTRACT_MODEL: string;
  EMBED_MODEL: string;
  INJECT_TOKEN_BUDGET: string;
  INJECT_RECENT_COUNT: string;
  INJECT_SEMANTIC_COUNT: string;
  AI_WORKER: Fetcher; // studio-gateway — routes memory extraction LLM calls
  MEMORY_AUTH_SECRET?: string;

  // ── Shared bindings ──────────────────────────────────────────────────────
  AI: Ai; // Workers AI — used by both rag embeddings and memory embeddings
  TRACKER?: Fetcher;
}
