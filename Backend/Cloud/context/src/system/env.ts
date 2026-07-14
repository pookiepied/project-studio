export interface Env {
  ENVIRONMENT: string;
  /** Studio Registry — the source of truth for what exists. */
  REGISTRY: Fetcher;
  /** Studio Data — conversations, attachments, files. */
  DATA: Fetcher;
  CONNECTORS: Fetcher;
  /** Studio MCP hub, used for scoped native memory retrieval. */
  MCP: Fetcher;
}
