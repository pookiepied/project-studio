/// <reference types="@cloudflare/workers-types" />

/**
 * Bindings for the studio-skills Worker.
 *
 * SKILLS_DB stores local skill *registrations* (metadata/manifests only) —
 * never local skill content. Bundled/system skill content is compiled into the
 * Worker at build time via the wrangler Text module rule on *.md.
 */
export interface Env {
  ENVIRONMENT?: string;

  SKILLS_DB: D1Database;

  // Durable Object backing the /mcp Streamable HTTP endpoint (McpAgent).
  MCP_OBJECT: DurableObjectNamespace;

  // Tracker — Project Studio telemetry (optional).
  TRACKER?: Fetcher;

  // Optional shared secret for service-to-service auth. When unset, auth is
  // disabled (internal service-binding access only — worker is workers_dev=false).
  SKILLS_AUTH_SECRET?: string;
}
