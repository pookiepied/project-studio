import type { GatewayEnv } from "./gatewayEnv";

export type { GatewayEnv } from "./gatewayEnv";

/**
 * Full binding set for the `studio-chat` Worker.
 * Gateway-layer bindings are inherited from GatewayEnv; this type adds
 * chat-only bindings (D1, Durable Objects, analytics, internal service fetchers).
 */
export interface Env extends GatewayEnv {
  // D1 — chat worker database (knowledge base documents)
  CHAT_DB: D1Database;

  // Cloudflare Analytics Engine — structured error and event telemetry
  ANALYTICS?: AnalyticsEngineDataset;

  // Service bindings — internal workers
  MEMORY?: Fetcher;   // studio-mcp-memory (direct, for pipeline inject/process/facts)
  MCP?: Fetcher;      // studio-mcp (hub — Composio execution + MCP tool manifest)
  AGENTS?: Fetcher;   // studio-agents (research sub-agents + blackboard)
  GATEWAY?: Fetcher;  // studio-gateway (LLM proxy — wired for future pipeline migration)
  SKILLS?: Fetcher;   // studio-skills (direct, for preload index fetch + skill_read shim)
  SKILLS_AUTH_SECRET?: string; // shared secret for internal studio-skills routes

  // Durable Objects
  CHAT_AGENT: DurableObjectNamespace;            // main WebSocket agent
}
