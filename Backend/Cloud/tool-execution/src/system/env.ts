export interface Env {
  ENVIRONMENT: string;
  TOOL_EXECUTION_DB: D1Database;
  DATA: Fetcher;
  REGISTRY: Fetcher;
  CONNECTORS: Fetcher;
  NATIVE_TOOLS: Fetcher;
  MEMORY: Fetcher;
  AGENT_RUNTIME: Fetcher;
  SKILL_LIBRARY: Fetcher;
}
