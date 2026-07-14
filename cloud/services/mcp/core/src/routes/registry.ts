/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionType = "mcp_local" | "mcp_remote" | "composio";

export interface ConnectionRow {
  id:           string;
  user_id:      string;
  type:         ConnectionType;
  name:         string;
  display_name: string;
  config:       string; // JSON string
  credentials:  string; // JSON string — never returned to clients
  active:       number;
  created_at:   number;
  updated_at:   number;
}

export interface ConnectionPublic {
  id:           string;
  type:         ConnectionType;
  name:         string;
  display_name: string;
  config:       unknown;
  active:       boolean;
  created_at:   number;
  updated_at:   number;
}

export function toPublic(row: ConnectionRow): ConnectionPublic {
  return {
    id:           row.id,
    type:         row.type,
    name:         row.name,
    display_name: row.display_name,
    config:       safeJson(row.config),
    active:       row.active === 1,
    created_at:   row.created_at,
    updated_at:   row.updated_at,
  };
}

export function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function listConnections(userId: string, env: Env): Promise<Response> {
  const { results } = await env.MCP_DB
    .prepare("SELECT * FROM external_connections WHERE user_id = ? AND active = 1 ORDER BY created_at DESC")
    .bind(userId)
    .all<ConnectionRow>();
  return json({ connections: (results ?? []).map(toPublic) });
}

export async function createConnection(userId: string, env: Env, request: Request): Promise<Response> {
  let body: { type?: string; name?: string; display_name?: string; config?: unknown; credentials?: unknown };
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const { type, name, display_name, config = {}, credentials = {} } = body;
  if (!type || !["mcp_local", "mcp_remote", "composio"].includes(type)) {
    return json({ error: "type must be one of: mcp_local, mcp_remote, composio" }, 400);
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    return json({ error: "name is required" }, 400);
  }
  if (!display_name || typeof display_name !== "string" || !display_name.trim()) {
    return json({ error: "display_name is required" }, 400);
  }

  const row = await env.MCP_DB
    .prepare(
      `INSERT INTO external_connections (user_id, type, name, display_name, config, credentials)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(userId, type, name.trim(), display_name.trim(), JSON.stringify(config), JSON.stringify(credentials))
    .first<ConnectionRow>();

  if (!row) return json({ error: "Failed to create connection" }, 500);
  return json({ connection: toPublic(row) }, 201);
}

export async function getConnection(userId: string, id: string, env: Env): Promise<Response> {
  const row = await env.MCP_DB
    .prepare("SELECT * FROM external_connections WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<ConnectionRow>();
  if (!row) return json({ error: "Not found" }, 404);
  return json({ connection: toPublic(row) });
}

export async function updateConnection(userId: string, id: string, env: Env, request: Request): Promise<Response> {
  const existing = await env.MCP_DB
    .prepare("SELECT * FROM external_connections WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<ConnectionRow>();
  if (!existing) return json({ error: "Not found" }, 404);

  let body: { display_name?: string; config?: unknown; credentials?: unknown; active?: boolean };
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const display_name = typeof body.display_name === "string" ? body.display_name.trim() : existing.display_name;
  const config       = body.config      !== undefined ? JSON.stringify(body.config)      : existing.config;
  const credentials  = body.credentials !== undefined ? JSON.stringify(body.credentials) : existing.credentials;
  const active       = body.active      !== undefined ? (body.active ? 1 : 0)            : existing.active;

  const row = await env.MCP_DB
    .prepare(
      `UPDATE external_connections
       SET display_name = ?, config = ?, credentials = ?, active = ?, updated_at = unixepoch()
       WHERE id = ? AND user_id = ?
       RETURNING *`
    )
    .bind(display_name, config, credentials, active, id, userId)
    .first<ConnectionRow>();

  if (!row) return json({ error: "Update failed" }, 500);
  return json({ connection: toPublic(row) });
}

export async function deleteConnection(userId: string, id: string, env: Env): Promise<Response> {
  const existing = await env.MCP_DB
    .prepare("SELECT id FROM external_connections WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<{ id: string }>();
  if (!existing) return json({ error: "Not found" }, 404);

  await env.MCP_DB
    .prepare("DELETE FROM external_connections WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return json({ deleted: true });
}

export async function listConnectionsByType(userId: string, type: string, env: Env): Promise<Response> {
  if (!["mcp_local", "mcp_remote", "composio"].includes(type)) {
    return json({ error: "type must be one of: mcp_local, mcp_remote, composio" }, 400);
  }
  const { results } = await env.MCP_DB
    .prepare("SELECT * FROM external_connections WHERE user_id = ? AND type = ? AND active = 1 ORDER BY created_at DESC")
    .bind(userId, type)
    .all<ConnectionRow>();
  return json({ connections: (results ?? []).map(toPublic) });
}

// ---------------------------------------------------------------------------
// Router — handles all /registry/connections/* paths
// ---------------------------------------------------------------------------

export async function handleRegistry(path: string, method: string, userId: string, env: Env, request: Request): Promise<Response | null> {
  // GET /registry/connections/type/:type
  const typeMatch = path.match(/^\/registry\/connections\/type\/([^/]+)$/);
  if (typeMatch && method === "GET") {
    return listConnectionsByType(userId, typeMatch[1], env);
  }

  // /registry/connections
  if (path === "/registry/connections") {
    if (method === "GET")  return listConnections(userId, env);
    if (method === "POST") return createConnection(userId, env, request);
  }

  // /registry/connections/:id
  const idMatch = path.match(/^\/registry\/connections\/([^/]+)$/);
  if (idMatch) {
    const id = idMatch[1];
    if (method === "GET")    return getConnection(userId, id, env);
    if (method === "PATCH")  return updateConnection(userId, id, env, request);
    if (method === "DELETE") return deleteConnection(userId, id, env);
  }

  return null;
}
