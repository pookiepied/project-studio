export interface Env {
  ENVIRONMENT: string;
  TOOL_POOL_DB: D1Database;
  REGISTRY: Fetcher;
  CONNECTORS: Fetcher;
  SKILL_LIBRARY: Fetcher;
  AGENT_LIBRARY: Fetcher;
}

