/// <reference types="@cloudflare/workers-types" />

export { StudioMemoryAgent } from "./mcp/agent";

import { StudioMemoryAgent } from "./mcp/agent";
import type { Env } from "./env";
import { buildInjectionContext, type InjectRequest } from "./pipeline/inject";
import { processConversation, type ProcessRequest } from "./background/process";
import { listFacts, deleteFact } from "./db/facts";
import { deleteConversation } from "./db/conversations";
import { deleteVector } from "./embeddings/vectorize";

const mcpFetch = StudioMemoryAgent.serve("/mcp");

function validateAuth(request: Request, env: Env): boolean {
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
      return json({ status: "ok", service: "studio-memory" });
    }

    // ── Facts REST API (for MemoriesPage) ────────────────────────────────
    if (url.pathname === "/facts" && request.method === "GET") {
      if (!validateAuth(request, env)) return json({ error: "Unauthorized" }, 401);
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

    if (url.pathname.startsWith("/facts/") && request.method === "DELETE") {
      if (!validateAuth(request, env)) return json({ error: "Unauthorized" }, 401);
      const id     = decodeURIComponent(url.pathname.slice("/facts/".length));
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

    // ── Service-to-service routes ────────────────────────────────────────
    if (url.pathname === "/inject" || url.pathname === "/process") {
      if (!validateAuth(request, env)) return json({ error: "Unauthorized" }, 401);
      if (request.method !== "POST")   return json({ error: "Method not allowed" }, 405);

      let body: unknown;
      try { body = await request.json(); }
      catch { return json({ error: "Invalid JSON" }, 400); }

      if (url.pathname === "/inject") {
        const req = body as InjectRequest;
        if (!req?.user_id || !req?.message) return json({ error: "user_id and message required" }, 400);
        const context = await buildInjectionContext(env, req, ctx).catch(() => "");
        return json({ context });
      }

      // /process — fire and forget
      const req = body as ProcessRequest;
      if (!req?.user_id || !req?.conversation_id || !req?.messages) {
        return json({ error: "user_id, conversation_id, and messages required" }, 400);
      }
      ctx.waitUntil(processConversation(env, req).catch(() => {}));
      return json({ queued: true });
    }

    // ── MCP endpoint ─────────────────────────────────────────────────────
    if (!validateAuth(request, env)) return json({ error: "Unauthorized" }, 401);
    return mcpFetch.fetch(request, env, ctx);
  },
};
