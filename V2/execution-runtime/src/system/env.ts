export interface Env {
  ENVIRONMENT: string;
  /** Gateway v2 — the only path to model providers. */
  GATEWAY: Fetcher;
  /** Studio Context — task-specific context packages. */
  CONTEXT: Fetcher;
  /** Studio Registry — capability lookups. */
  REGISTRY: Fetcher;
  /** Studio Data — conversation and artifact persistence. */
  DATA: Fetcher;
  MCP: Fetcher;
  /** One session per active conversation/run. */
  EXECUTION_SESSION: DurableObjectNamespace;
}
