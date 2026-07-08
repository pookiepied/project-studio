/// <reference types="@cloudflare/workers-types" />

export interface Env {
  ENVIRONMENT?: string;

  // Durable Object — McpAgent state (one DO class per MCP server).
  MCP_OBJECT: DurableObjectNamespace;

  // Service bindings
  GATEWAY?: Fetcher; // studio-gateway — image/video generation
  TRACKER?: Fetcher; // tracker Worker — telemetry

  // Generation group (image_generate) — shared studio-images bucket; the gateway
  // serves /v1/images/:id from the same bucket and owns the 7-day cleanup cron.
  IMAGES_BUCKET?:     R2Bucket;
  PUBLIC_IMAGE_BASE?: string; // public origin serving the gateway's /v1/images/:id

  // Retrieval group (web_fetch, rag) — shared studio-rag index + embeddings.
  VECTORIZE?: VectorizeIndex; // studio-rag (768-dim, @cf/baai/bge-base-en-v1.5)
  AI?:        Ai;             // Workers AI — embedding generation
  MCP_KV?:    KVNamespace;    // rag TOC cache (shared namespace with chat)

  // web_search providers
  TAVILY_API_KEY?:       string;
  BRAVE_SEARCH_API_KEY?: string;

  // Optional service-to-service auth. Unset = internal-only (service binding).
  TOOLS_AUTH_SECRET?: string;
}
