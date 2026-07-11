/**
 * The service bindings every runtime built on the engine needs. Each worker's
 * own Env extends this and adds its Durable Object namespace binding (and any
 * runtime-specific bindings). Keeping the shared surface small means the base
 * RuntimeSession never reaches for a binding a subclass didn't promise.
 */
export interface RuntimeEnv {
  ENVIRONMENT: string;
  /** Gateway v2 — the only path to model providers. */
  GATEWAY: Fetcher;
  /** Studio Context — task-specific context packages. */
  CONTEXT: Fetcher;
  /** Studio Data — conversation and artifact persistence. */
  DATA: Fetcher;
  /** Studio MCP hub — cloud tool execution. */
  MCP: Fetcher;
}
