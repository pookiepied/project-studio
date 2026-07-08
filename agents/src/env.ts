/// <reference types="@cloudflare/workers-types" />

export interface Env {
  ENVIRONMENT?: string;

  // Durable Objects
  // Per-conversation shared blackboard for agent-to-agent coordination.
  // Reached by chat via the AGENTS service binding, and by sub-agents directly.
  BLACKBOARD: DurableObjectNamespace;

  // Spawnable agent DO namespaces — one entry per agent type.
  // Each run gets its own DO instance via idFromName(runId).
  RESEARCH_AGENT: DurableObjectNamespace;

  // Service bindings
  MCP_TOOLS: Fetcher;  // studio-mcp hub — tool catalog + cloud execution router
  TRACKER?:  Fetcher;  // tracker Worker
  MEMORY?:   Fetcher;  // studio-mcp-memory — context inject at loop start

  // KV — MCP tool manifests (mcp_manifest:{name}); shared namespace with chat.
  // Read by the tool loader to get local/remote MCP tool schemas.
  MCP_KV: KVNamespace;

  // D1 — agents-owned database (not shared with studio-chat)
  AGENTS_DB: D1Database;

  // Gateway — all LLM calls go through the studio-gateway worker
  GATEWAY: Fetcher;

  // Service-to-service auth with studio-mcp-memory
  MEMORY_AUTH_SECRET?: string;
}
