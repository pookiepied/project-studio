export interface Env {
  ENVIRONMENT: string;
  /** Gateway v2 — the only path to model providers. */
  GATEWAY: Fetcher;
  /** Studio Context — task-specific context packages. */
  CONTEXT: Fetcher;
}
