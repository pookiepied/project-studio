/// <reference types="@cloudflare/workers-types" />

// ---------------------------------------------------------------------------
// studio-mcp-library — one Cloudflare Worker hosting every first-party
// "cloud" MCP server STUDIO ships, organized by category:
//
//   src/tools/<name>/     stateless work tools (e.g. studio-tools: web_search,
//                         web_fetch, rag, image/video gen, http_request)
//   src/services/<name>/  stateful backend services exposed as MCP servers
//                         (e.g. studio-memory: recall/search/note/relate)
//
// Adding a new cloud MCP server means adding a new folder under tools/ or
// services/ (or a new category folder) and a few lines below — never a new
// top-level Worker.
// ---------------------------------------------------------------------------

export { StudioToolsAgent } from "./tools/studio-tools/mcp/agent";
export { StudioMemoryAgent } from "./services/studio-memory/mcp/agent";

import { StudioToolsAgent } from "./tools/studio-tools/mcp/agent";
import { StudioMemoryAgent } from "./services/studio-memory/mcp/agent";
import type { Env } from "./env";
import { buildInjectionContext, type InjectRequest } from "./services/studio-memory/pipeline/inject";
import { processConversation, type ProcessRequest } from "./services/studio-memory/background/process";
import { listFacts, deleteFact } from "./services/studio-memory/db/facts";
import { deleteConversation } from "./services/studio-memory/db/conversations";
import { deleteVector } from "./services/studio-memory/embeddings/vectorize";

const toolsFetch  = StudioToolsAgent.serve("/tools/studio-tools/mcp", { binding: "TOOLS_OBJECT" });
const memoryFetch = StudioMemoryAgent.serve("/services/studio-memory/mcp", { binding: "MEMORY_OBJECT" });

function validateToolsAuth(request: Request, env: Env): boolean {
  if (!env.TOOLS_AUTH_SECRET) return true; // internal-only: auth disabled
  const auth  = request.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return token === env.TOOLS_AUTH_SECRET;
}

function validateMemoryAuth(request: Request, env: Env): boolean {
  if (!env.MEMORY_AUTH_SECRET) return true; // dev: auth disabled
  const auth  = request.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return token === env.MEMORY_AUTH_SECRET;
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
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id",
          "Access-Control-Max-Age":       "86400",
        },
      });
    }

    // ── Health check (no auth) ───────────────────────────────────────────
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "ok", service: "studio-mcp-library", servers: ["studio-tools", "studio-memory"] });
    }

    // ── Memory: facts REST API (for MemoriesPage) ────────────────────────
    if (url.pathname === "/services/studio-memory/facts" && request.method === "GET") {
      if (!validateMemoryAuth(request, env)) return json({ error: "Unauthorized" }, 401);
      const userId = url.searchParams.get("user_id");
      if (!userId) return json({ error: "user_id required" }, 400);
      const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
      const { facts } = await listFacts(env, userId, { limit });
      const memories = facts.map((f) => ({
        key:        f.id,
        content:    f.content,
        tags:       f.autoTags,
        category:   f.category,
        importance: f.importance,
        updatedAt:  f.updatedAt,
      }));
      return json({ memories, total: memories.length });
    }

    if (url.pathname.startsWith("/services/studio-memory/facts/") && request.method === "DELETE") {
      if (!validateMemoryAuth(request, env)) return json({ error: "Unauthorized" }, 401);
      const id     = decodeURIComponent(url.pathname.slice("/services/studio-memory/facts/".length));
      const userId = url.searchParams.get("user_id");
      const type   = url.searchParams.get("type") ?? "fact";
      if (!userId || !id) return json({ error: "user_id and id required" }, 400);
      let deleted = false;
      if (type === "fact") {
        deleted = await deleteFact(env, userId, id);
        if (deleted) await deleteVector(env, `fact:${id}`).catch(() => {});
      } else {
        deleted = await deleteConversation(env, userId, id);
        if (deleted) await deleteVector(env, `conv:${id}`).catch(() => {});
      }
      return json({ deleted, id });
    }

    // ── Memory: service-to-service routes ────────────────────────────────
    if (url.pathname === "/services/studio-memory/inject" || url.pathname === "/services/studio-memory/process") {
      if (!validateMemoryAuth(request, env)) return json({ error: "Unauthorized" }, 401);
      if (request.method !== "POST")         return json({ error: "Method not allowed" }, 405);

      let body: unknown;
      try { body = await request.json(); }
      catch { return json({ error: "Invalid JSON" }, 400); }

      if (url.pathname === "/services/studio-memory/inject") {
        const req = body as InjectRequest;
        if (!req?.user_id || !req?.message) return json({ error: "user_id and message required" }, 400);
        const context = await buildInjectionContext(env, req, ctx).catch(() => "");
        return json({ context });
      }

      // /services/studio-memory/process — fire and forget
      const req = body as ProcessRequest;
      if (!req?.user_id || !req?.conversation_id || !req?.messages) {
        return json({ error: "user_id, conversation_id, and messages required" }, 400);
      }
      ctx.waitUntil(processConversation(env, req).catch(() => {}));
      return json({ queued: true });
    }

    // ── Tools: MCP endpoint ───────────────────────────────────────────────
    if (url.pathname.startsWith("/tools/studio-tools/")) {
      if (!validateToolsAuth(request, env)) return json({ error: "Unauthorized" }, 401);
      return toolsFetch.fetch(request, env, ctx);
    }

    // ── Memory: MCP endpoint ──────────────────────────────────────────────
    if (url.pathname.startsWith("/services/studio-memory/")) {
      if (!validateMemoryAuth(request, env)) return json({ error: "Unauthorized" }, 401);
      return memoryFetch.fetch(request, env, ctx);
    }

    return json({ error: "Not found" }, 404);
  },
};
