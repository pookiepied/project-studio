/// <reference types="@cloudflare/workers-types" />

export interface Env {
  ENVIRONMENT?: string;

  MCP_DB: D1Database;

  // Native system MCP service bindings
  MEMORY?: Fetcher;             // studio-mcp-memory
  YOUTUBE_TRANSCRIPT?: Fetcher; // studio-youtube-transcript
  TOOLS?: Fetcher;              // studio-mcp-tools — first-party native work tools
  SKILLS?: Fetcher;             // studio-skills — bundled + local skill catalog

  // Composio integration
  COMPOSIO_API_KEY?: string;

  JWT_SECRET?:         string;
  MEMORY_AUTH_SECRET?: string;
}
