export interface Env {
  ENVIRONMENT: string;
  /** Studio Registry - the source of truth for what exists. */
  REGISTRY: Fetcher;
  /** Studio Data - conversations, attachments, files. */
  DATA: Fetcher;
  /** Studio Tool Pool - callable capability discovery and materialization. */
  TOOL_POOL: Fetcher;
  /** Context Engine internal durable state. */
  CONTEXT_DB: D1Database;
  CONNECTORS: Fetcher;
  /** Studio MCP hub, used for scoped native memory retrieval. */
  MCP: Fetcher;
}
