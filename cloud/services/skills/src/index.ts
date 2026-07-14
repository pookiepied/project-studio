/// <reference types="@cloudflare/workers-types" />

// Re-export the DO class so Wrangler's durable_objects binding resolves it.
export { StudioSkillsAgent } from "./mcp/agent";

import { StudioSkillsAgent } from "./mcp/agent";
import type { Env } from "./env";
import { json, validateAuth } from "./http/responses";
import { handleInternalRoutes } from "./http/internalRoutes";

const mcpFetch = StudioSkillsAgent.serve("/mcp");

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Health check (no auth) — used by deploy probes.
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "ok", service: "studio-skills" });
    }

    // REST internal routes — service-binding callers only.
    const internal = await handleInternalRoutes(request, env, url);
    if (internal) return internal;

    // MCP Streamable HTTP endpoint (proxied by the studio-mcp hub).
    // Everything not matched above and not under /internal is treated as MCP.
    if (url.pathname === "/mcp" || url.pathname === "/") {
      if (!validateAuth(request, env)) return json({ error: "Unauthorized" }, 401);
      return mcpFetch.fetch(request, env, ctx);
    }

    return json({ error: "Not found" }, 404);
  },
};
