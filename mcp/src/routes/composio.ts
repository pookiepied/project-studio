/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";

const COMPOSIO_API = "https://backend.composio.tech/api";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComposioAuthRow {
  id:               string;
  user_id:          string;
  app_name:         string;
  display_name:     string;
  entity_id:        string;
  connection_id:    string | null;
  status:           string;
  tools_json:       string;
  tools_fetched_at: number | null;
  created_at:       number;
  updated_at:       number;
}

interface ComposioAction {
  name:            string;
  slug:            string;
  description:     string;
  appName:         string;
  inputParameters: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Composio API helpers
// ---------------------------------------------------------------------------

async function composioGet(path: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${COMPOSIO_API}${path}`, {
    headers: { "X-API-Key": apiKey, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Composio API ${path} returned HTTP ${res.status}`);
  return res.json();
}

async function fetchComposioTools(apiKey: string, appName: string, entityId: string): Promise<ComposioAction[]> {
  const data = await composioGet(
    `/v2/actions?apps=${encodeURIComponent(appName)}&limit=50&enabled=true&entityId=${encodeURIComponent(entityId)}`,
    apiKey,
  ) as { items?: ComposioAction[] };
  return data.items ?? [];
}

// ---------------------------------------------------------------------------
// POST /internal/composio/execute
// Called by chat's ComposioTool — proxies execution to Composio API.
// ---------------------------------------------------------------------------

export async function handleComposioExecute(env: Env, request: Request): Promise<Response> {
  if (!env.COMPOSIO_API_KEY) {
    return json({ success: false, error: "Composio not configured (COMPOSIO_API_KEY missing)" }, 503);
  }

  let body: { slug?: string; connectionId?: string; entityId?: string; args?: unknown };
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const { slug, connectionId, entityId, args } = body;
  if (!slug || !connectionId || !entityId) {
    return json({ success: false, error: "slug, connectionId, and entityId are required" }, 400);
  }

  try {
    const res = await fetch(`${COMPOSIO_API}/v3/actions/${encodeURIComponent(slug)}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.COMPOSIO_API_KEY,
      },
      body: JSON.stringify({
        connectedAccountId: connectionId,
        entityId,
        input: args ?? {},
      }),
    });

    const data = await res.json() as { successfull?: boolean; data?: unknown; error?: unknown };
    if (!res.ok || data.successfull === false) {
      return json({ success: false, error: data.error ?? `Composio returned HTTP ${res.status}` });
    }
    return json({ success: true, data: data.data ?? data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ success: false, error: msg }, 502);
  }
}

// ---------------------------------------------------------------------------
// GET /internal/tools/composio?userId=...
// Called by chat preload — returns all Composio tool schemas for a user.
// ---------------------------------------------------------------------------

export async function handleComposioToolsForUser(userId: string, env: Env): Promise<Response> {
  const { results } = await env.MCP_DB
    .prepare("SELECT * FROM composio_auth WHERE user_id = ? AND status = 'active' ORDER BY app_name")
    .bind(userId)
    .all<ComposioAuthRow>();

  const rows = results ?? [];
  const allTools: { slug: string; name: string; description: string; inputParameters: Record<string, unknown>; connectionId: string }[] = [];
  const apps: { appName: string; displayName: string; tools: { name: string; description: string }[] }[] = [];

  for (const row of rows) {
    if (!row.connection_id) continue;

    let actions: ComposioAction[] = [];
    try { actions = JSON.parse(row.tools_json); } catch { continue; }
    if (actions.length === 0) continue;

    const appTools: { name: string; description: string }[] = [];
    for (const a of actions) {
      if (!a.slug || !a.name) continue;
      const toolName = `composio_${row.app_name.toLowerCase()}__${a.slug.toLowerCase()}`;
      allTools.push({
        slug:            a.slug,
        name:            toolName,
        description:     a.description ?? a.name,
        inputParameters: a.inputParameters ?? {},
        connectionId:    row.connection_id,
      });
      appTools.push({ name: toolName, description: a.description ?? a.name });
    }
    if (appTools.length > 0) {
      apps.push({ appName: row.app_name, displayName: row.display_name, tools: appTools });
    }
  }

  return json({ tools: allTools, apps });
}

// ---------------------------------------------------------------------------
// Registry CRUD for Composio auth — /registry/composio/*
// ---------------------------------------------------------------------------

export async function listComposioApps(userId: string, env: Env): Promise<Response> {
  const { results } = await env.MCP_DB
    .prepare("SELECT id, app_name, display_name, status, connection_id, tools_fetched_at, created_at, updated_at FROM composio_auth WHERE user_id = ? ORDER BY app_name")
    .bind(userId)
    .all<ComposioAuthRow>();
  return json({ apps: results ?? [] });
}

export async function getComposioApp(userId: string, appName: string, env: Env): Promise<Response> {
  const row = await env.MCP_DB
    .prepare("SELECT id, app_name, display_name, status, connection_id, tools_fetched_at, created_at, updated_at FROM composio_auth WHERE user_id = ? AND app_name = ?")
    .bind(userId, appName.toUpperCase())
    .first<ComposioAuthRow>();
  if (!row) return json({ error: "Not found" }, 404);
  return json({ app: row });
}

export async function connectComposioApp(userId: string, appName: string, env: Env, request: Request): Promise<Response> {
  let body: { display_name?: string; connection_id?: string; sync_tools?: boolean };
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const normalized = appName.toUpperCase();
  const entityId   = userId; // use userId as Composio entity by convention
  const { display_name = normalized, connection_id, sync_tools = false } = body;

  // Fetch tools from Composio if we have a connectionId and API key
  let toolsJson = "[]";
  let toolsFetchedAt: number | null = null;
  if (connection_id && sync_tools && env.COMPOSIO_API_KEY) {
    try {
      const actions = await fetchComposioTools(env.COMPOSIO_API_KEY, normalized, entityId);
      toolsJson      = JSON.stringify(actions);
      toolsFetchedAt = Math.floor(Date.now() / 1000);
    } catch { /* proceed without tools — can sync later */ }
  }

  const status = connection_id ? "active" : "initiated";

  await env.MCP_DB
    .prepare(
      `INSERT INTO composio_auth (user_id, app_name, display_name, entity_id, connection_id, status, tools_json, tools_fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, app_name) DO UPDATE SET
         display_name     = excluded.display_name,
         connection_id    = COALESCE(excluded.connection_id, connection_id),
         status           = excluded.status,
         tools_json       = excluded.tools_json,
         tools_fetched_at = excluded.tools_fetched_at,
         updated_at       = unixepoch()`
    )
    .bind(userId, normalized, display_name, entityId, connection_id ?? null, status, toolsJson, toolsFetchedAt)
    .run();

  const row = await env.MCP_DB
    .prepare("SELECT id, app_name, display_name, status, connection_id, created_at, updated_at FROM composio_auth WHERE user_id = ? AND app_name = ?")
    .bind(userId, normalized)
    .first<ComposioAuthRow>();

  return json({ app: row }, connection_id ? 200 : 201);
}

export async function syncComposioTools(userId: string, appName: string, env: Env): Promise<Response> {
  if (!env.COMPOSIO_API_KEY) {
    return json({ error: "COMPOSIO_API_KEY not configured" }, 503);
  }

  const normalized = appName.toUpperCase();
  const row = await env.MCP_DB
    .prepare("SELECT * FROM composio_auth WHERE user_id = ? AND app_name = ?")
    .bind(userId, normalized)
    .first<ComposioAuthRow>();
  if (!row) return json({ error: "App not connected" }, 404);

  try {
    const actions      = await fetchComposioTools(env.COMPOSIO_API_KEY, normalized, row.entity_id);
    const toolsJson    = JSON.stringify(actions);
    const fetchedAt    = Math.floor(Date.now() / 1000);
    await env.MCP_DB
      .prepare("UPDATE composio_auth SET tools_json = ?, tools_fetched_at = ?, updated_at = unixepoch() WHERE user_id = ? AND app_name = ?")
      .bind(toolsJson, fetchedAt, userId, normalized)
      .run();
    return json({ synced: true, tool_count: actions.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: `Composio API error: ${msg}` }, 502);
  }
}

export async function disconnectComposioApp(userId: string, appName: string, env: Env): Promise<Response> {
  const normalized = appName.toUpperCase();
  const existing = await env.MCP_DB
    .prepare("SELECT id FROM composio_auth WHERE user_id = ? AND app_name = ?")
    .bind(userId, normalized)
    .first<{ id: string }>();
  if (!existing) return json({ error: "Not found" }, 404);

  await env.MCP_DB
    .prepare("DELETE FROM composio_auth WHERE user_id = ? AND app_name = ?")
    .bind(userId, normalized)
    .run();
  return json({ disconnected: true, app_name: normalized });
}

// ---------------------------------------------------------------------------
// Router — handles /registry/composio/* and /internal/tools/composio paths
// ---------------------------------------------------------------------------

export async function handleComposioRoutes(
  path: string,
  method: string,
  userId: string | null,
  env: Env,
  request: Request,
  url: URL,
): Promise<Response | null> {
  // Internal: tool discovery for chat preload
  if (path === "/internal/tools/composio" && method === "GET") {
    const qUserId = url.searchParams.get("userId");
    if (!qUserId) return new Response(JSON.stringify({ error: "userId required" }), { status: 400 });
    return handleComposioToolsForUser(qUserId, env);
  }

  // Internal: tool execution proxy
  if (path === "/internal/composio/execute" && method === "POST") {
    return handleComposioExecute(env, request);
  }

  // Registry routes (require auth)
  if (!userId) return null;

  if (path === "/registry/composio/auth" && method === "GET") {
    return listComposioApps(userId, env);
  }

  // /registry/composio/auth/:appName
  const appMatch = path.match(/^\/registry\/composio\/auth\/([^/]+)$/);
  if (appMatch) {
    const appName = appMatch[1];
    if (method === "GET")    return getComposioApp(userId, appName, env);
    if (method === "POST")   return connectComposioApp(userId, appName, env, request);
    if (method === "DELETE") return disconnectComposioApp(userId, appName, env);
  }

  // /registry/composio/auth/:appName/sync-tools
  const syncMatch = path.match(/^\/registry\/composio\/auth\/([^/]+)\/sync-tools$/);
  if (syncMatch && method === "POST") {
    return syncComposioTools(userId, syncMatch[1], env);
  }

  return null;
}
