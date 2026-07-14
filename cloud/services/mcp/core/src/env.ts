/// <reference types="@cloudflare/workers-types" />

export interface Env {
  ENVIRONMENT?: string;

  MCP_DB: D1Database;

  // Native system MCP service bindings.
  // MEMORY and TOOLS both point at studio-mcp-library (one worker, routed by
  // path prefix — see NATIVE_SERVICES.mcpPath in routes/internal.ts).
  MEMORY?: Fetcher;             // studio-mcp-library — studio-memory service
  YOUTUBE_TRANSCRIPT?: Fetcher; // studio-youtube-transcript
  TOOLS?: Fetcher;              // studio-mcp-library — studio-tools service
  SKILLS?: Fetcher;             // studio-skills — bundled + local skill catalog

  // Composio integration
  COMPOSIO_API_KEY?: string;

  JWT_SECRET?:         string;
  MEMORY_AUTH_SECRET?: string;
}
