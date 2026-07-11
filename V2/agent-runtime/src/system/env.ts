export interface Env {
  ENVIRONMENT: string;
  /** Gateway v2 — the only path to model providers. */
  GATEWAY: Fetcher;
  /** Studio Registry — agent definitions. */
  REGISTRY: Fetcher;
  /** Studio Context — capability resolution for the agent. */
  CONTEXT: Fetcher;
}
