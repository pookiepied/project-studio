import { recordResourceVersion } from "../../database/resourceVersions";
import { conflict } from "../../errors/appError";
import { parseJson, stringifyJson } from "../../system/json";
import { readableOwnerKeys } from "../../system/ownership";
import type { McpServerRecord, McpServerSearch, McpToolRecord } from "./types";

type McpRow = Record<string, unknown>;

export async function listMcpServers(db: D1Database, search: McpServerSearch): Promise<McpServerRecord[]> {
  const [systemKey, userKey] = readableOwnerKeys(search.userId);
  const clauses = ["owner_key IN (?, ?)"];
  const values: unknown[] = [systemKey, userKey];

  if (search.status) {
    clauses.push("status = ?");
    values.push(search.status);
  }
  if (search.origin) {
    clauses.push("origin = ?");
    values.push(search.origin);
  }
  if (search.ownerType) {
    clauses.push("owner_type = ?");
    values.push(search.ownerType);
  }
  if (search.transport) {
    clauses.push("transport = ?");
    values.push(search.transport);
  }
  if (search.query) {
    clauses.push("(name LIKE ? OR slug LIKE ? OR description LIKE ?)");
    const query = `%${search.query}%`;
    values.push(query, query, query);
  }
  if (search.tag) {
    clauses.push("tags LIKE ?");
    values.push(`%"${search.tag}"%`);
  }

  const result = await db
    .prepare(`SELECT * FROM mcp_servers WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`)
    .bind(...values, search.limit)
    .all<McpRow>();
  return (result.results ?? []).map(toMcpServer);
}

export async function getMcpServer(db: D1Database, userId: string, id: string): Promise<McpServerRecord | null> {
  const [systemKey, userKey] = readableOwnerKeys(userId);
  const row = await db
    .prepare("SELECT * FROM mcp_servers WHERE id = ? AND owner_key IN (?, ?)")
    .bind(id, systemKey, userKey)
    .first<McpRow>();
  return row ? toMcpServer(row) : null;
}

export async function saveMcpServer(db: D1Database, server: McpServerRecord, changeNote?: string): Promise<McpServerRecord> {
  try {
    await db
      .prepare(
        `INSERT INTO mcp_servers (
          id, owner_type, owner_user_id, owner_key, name, slug, description, origin, status, current_version,
          transport, endpoint_ref, auth_ref, config_ref, tools, permissions,
          tags, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(id, owner_key) DO UPDATE SET
          name = excluded.name,
          slug = excluded.slug,
          description = excluded.description,
          origin = excluded.origin,
          status = excluded.status,
          current_version = excluded.current_version,
          transport = excluded.transport,
          endpoint_ref = excluded.endpoint_ref,
          auth_ref = excluded.auth_ref,
          config_ref = excluded.config_ref,
          tools = excluded.tools,
          permissions = excluded.permissions,
          tags = excluded.tags,
          metadata = excluded.metadata,
          updated_at = datetime('now')`,
      )
      .bind(
        server.id,
        server.ownerType,
        server.ownerUserId ?? null,
        server.ownerKey,
        server.name,
        server.slug,
        server.description,
        server.origin,
        server.status,
        server.currentVersion,
        server.transport,
        server.endpointRef ?? null,
        server.authRef ?? null,
        server.configRef ?? null,
        stringifyJson(server.tools),
        stringifyJson(server.permissions),
        stringifyJson(server.tags),
        stringifyJson(server.metadata),
      )
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) throw conflict("MCP server id or slug already exists for this owner.");
    throw error;
  }

  await recordResourceVersion(db, {
    kind: "mcp-server",
    resourceId: server.id,
    ownerType: server.ownerType,
    ownerKey: server.ownerKey,
    version: server.currentVersion,
    configRef: server.configRef ?? server.endpointRef,
    metadata: { name: server.name, slug: server.slug, status: server.status, transport: server.transport },
    changeNote,
  });

  const saved = await getMcpServer(db, server.ownerUserId ?? "system", server.id);
  if (!saved) throw new Error("Failed to reload saved MCP server.");
  return saved;
}

export async function deleteMcpServer(db: D1Database, userId: string, id: string): Promise<boolean> {
  const [systemKey, userKey] = readableOwnerKeys(userId);
  const result = await db.prepare("DELETE FROM mcp_servers WHERE id = ? AND owner_key IN (?, ?)").bind(id, systemKey, userKey).run();
  return result.meta.changes > 0;
}

function toMcpServer(row: McpRow): McpServerRecord {
  return {
    id: String(row.id),
    ownerType: row.owner_type as McpServerRecord["ownerType"],
    ownerUserId: row.owner_user_id ? String(row.owner_user_id) : undefined,
    ownerKey: String(row.owner_key),
    name: String(row.name),
    slug: String(row.slug),
    description: String(row.description ?? ""),
    origin: row.origin as McpServerRecord["origin"],
    status: row.status as McpServerRecord["status"],
    currentVersion: String(row.current_version),
    transport: row.transport as McpServerRecord["transport"],
    endpointRef: row.endpoint_ref ? String(row.endpoint_ref) : undefined,
    authRef: row.auth_ref ? String(row.auth_ref) : undefined,
    configRef: row.config_ref ? String(row.config_ref) : undefined,
    tools: parseJson<McpToolRecord[]>(row.tools, []),
    permissions: parseJson<string[]>(row.permissions, []),
    tags: parseJson<string[]>(row.tags, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
