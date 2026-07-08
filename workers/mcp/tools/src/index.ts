/// <reference types="@cloudflare/workers-types" />

export { StudioToolsAgent } from "./mcp/agent";

import { StudioToolsAgent } from "./mcp/agent";
import type { Env } from "./env";

// ---------------------------------------------------------------------------
// studio-mcp-tools Worker
//
// Internal-only (workers_dev = false). Reached via the studio-mcp hub's
// /internal/native/execute route over a service binding. The hub performs the
// MCP Streamable HTTP handshake against /mcp and routes tools/call here.
// ---------------------------------------------------------------------------

const mcpFetch = StudioToolsAgent.serve("/mcp");

function validateAuth(request: Request, env: Env): boolean {
  if (!env.TOOLS_AUTH_SECRET) return true; // internal-only: auth disabled
  const auth  = request.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return token === env.TOOLS_AUTH_SECRET;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin":  "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id",
          "Access-Control-Max-Age":       "86400",
        },
      });
    }

    // ── Health check (no auth) ───────────────────────────────────────────
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "ok", service: "studio-tools" });
    }

    // ── MCP endpoint ─────────────────────────────────────────────────────
    if (!validateAuth(request, env)) return json({ error: "Unauthorized" }, 401);
    return mcpFetch.fetch(request, env, ctx);
  },
};
