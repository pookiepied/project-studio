export interface Env {
  ENVIRONMENT: string;
  TOOL_EXECUTION_DB: D1Database;
  REGISTRY: Fetcher;
  AGENT_RUNTIME: Fetcher;
  SKILL_LIBRARY: Fetcher;
}
