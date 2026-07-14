import type { RegistryMcpRecord } from "@studio/v2-contracts";

type McpRow = Record<string, unknown>;

export async function listMcpServers(db: D1Database, userId: string): Promise<RegistryMcpRecord[]> {
  const result = await db.prepare("SELECT * FROM mcp_servers WHERE user_id = ? ORDER BY name").bind(userId).all<McpRow>();
  return (result.results ?? []).map(toRecord);
}

export async function getMcpServer(db: D1Database, userId: string, id: string): Promise<RegistryMcpRecord | null> {
  const row = await db.prepare("SELECT * FROM mcp_servers WHERE user_id = ? AND id = ?").bind(userId, id).first<McpRow>();
  return row ? toRecord(row) : null;
}

export async function upsertMcpServer(db: D1Database, record: RegistryMcpRecord, machineId?: string): Promise<void> {
  await db.prepare(`INSERT INTO mcp_servers
    (id,user_id,name,origin,location,enabled,available,transport,auth_ref,tools,permissions,metadata,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(id,user_id) DO UPDATE SET name=excluded.name,origin=excluded.origin,location=excluded.location,
      enabled=excluded.enabled,available=excluded.available,transport=excluded.transport,auth_ref=excluded.auth_ref,
      tools=excluded.tools,permissions=excluded.permissions,metadata=excluded.metadata,updated_at=datetime('now')`)
    .bind(record.ref.id, record.userId, record.ref.name, record.origin, record.location,
      Number(record.enabled), Number(record.available), record.transport, record.configRef ?? null,
      JSON.stringify(record.tools), JSON.stringify(record.permissions),
      JSON.stringify({ ...record.metadata, machineId, localRegistrationId: record.localRegistrationId, verifiedAt: record.verifiedAt }))
    .run();
}

export async function deleteMcpServer(db: D1Database, userId: string, id: string): Promise<void> {
  await db.prepare("DELETE FROM mcp_servers WHERE user_id = ? AND id = ?").bind(userId, id).run();
}

function toRecord(row: McpRow): RegistryMcpRecord {
  const metadata = parseObject(row.metadata);
  return {
    ref: { id: String(row.id), kind: "mcp-server", name: String(row.name) }, userId: String(row.user_id),
    origin: row.origin as RegistryMcpRecord["origin"], location: row.location as RegistryMcpRecord["location"],
    enabled: Boolean(row.enabled), available: Boolean(row.available), permissions: parseArray(row.permissions),
    configRef: row.auth_ref ? String(row.auth_ref) : undefined, metadata,
    transport: (row.transport || "stdio") as RegistryMcpRecord["transport"], tools: parseArray(row.tools),
    localRegistrationId: typeof metadata.localRegistrationId === "string" ? metadata.localRegistrationId : undefined,
    verifiedAt: typeof metadata.verifiedAt === "string" ? metadata.verifiedAt : undefined,
  };
}

function parseArray<T>(value: unknown): T[] { try { return JSON.parse(String(value ?? "[]")); } catch { return []; } }
function parseObject(value: unknown): Record<string, unknown> { try { return JSON.parse(String(value ?? "{}")); } catch { return {}; } }
