export interface Env {
  ENVIRONMENT: string;
  /** D1 database holding user-scoped capability records. */
  REGISTRY_DB: D1Database;
  /** Existing Studio MCP hub; used only to refresh platform metadata. */
  MCP: Fetcher;
}
