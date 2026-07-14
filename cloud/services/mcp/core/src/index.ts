/// <reference types="@cloudflare/workers-types" />

import type { Env } from "./env";
import { handleRegistry } from "./routes/registry";
import { handleComposioRoutes } from "./routes/composio";
import { handleInternalRoutes } from "./routes/internal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age":       "86400",
};

function cors(response: Response): Response {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(CORS_HEADERS)) r.headers.set(k, v);
  return r;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Auth — decode JWT payload to extract userId.
// MCP hub trusts the token from chat (already verified upstream); it only
// needs the sub claim to scope database queries.
// ---------------------------------------------------------------------------

function extractUserId(request: Request): string | null {
  const auth  = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  try {
    const parts  = token.split(".");
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
    const payload = JSON.parse(decoded) as Record<string, unknown>;
    const sub = payload["sub"];
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

function isInternalCall(request: Request): boolean {
  const url = new URL(request.url);
  // Service binding calls arrive with hostname "internal" or workers.dev subdomains
  return url.hostname === "internal" || url.hostname.includes("workers.dev");
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function route(request: Request, env: Env): Promise<Response> {
  const url    = new URL(request.url);
  const path   = url.pathname;
  const method = request.method;

  // Health — no auth
  if (path === "/health" && method === "GET") {
    return json({ status: "ok", service: "studio-mcp" });
  }

  const internal = isInternalCall(request);
  const userId   = extractUserId(request);

  // ---------------------------------------------------------------------------
  // Internal routes (/internal/*) — service binding only, no JWT required
  // ---------------------------------------------------------------------------
  if (path.startsWith("/internal/")) {
    // Composio: execution + tool discovery
    const composioRes = await handleComposioRoutes(path, method, null, env, request, url);
    if (composioRes) return composioRes;

    // Native + connections
    const internalRes = await handleInternalRoutes(path, method, env, request, url);
    if (internalRes) return internalRes;

    return json({ error: "Not Found" }, 404);
  }

  // ---------------------------------------------------------------------------
  // Public registry routes (/registry/*) — require JWT auth
  // ---------------------------------------------------------------------------
  if (path.startsWith("/registry/")) {
    if (!userId) return json({ error: "Unauthorized" }, 401);

    // Composio auth management
    if (path.startsWith("/registry/composio/")) {
      const composioRes = await handleComposioRoutes(path, method, userId, env, request, url);
      if (composioRes) return composioRes;
    }

    // Connection CRUD
    if (path.startsWith("/registry/connections")) {
      const registryRes = await handleRegistry(path, method, userId, env, request);
      if (registryRes) return registryRes;
    }

    return json({ error: "Not Found" }, 404);
  }

  return json({ error: "Not Found" }, 404);
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const response = await route(request, env);
    return cors(response);
  },
};
