import { conflict } from "../../errors/appError";
import { parseJson, stringifyJson } from "../../system/json";
import { readableOwnerKeys } from "../../system/ownership";
import type { AgentCapabilitySummary, AgentRegistration, AgentSearch } from "./types";

type AgentRow = Record<string, unknown>;

export async function listAgents(db: D1Database, search: AgentSearch): Promise<AgentRegistration[]> {
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
  if (search.runtimeType) {
    clauses.push("runtime_type = ?");
    values.push(search.runtimeType);
  }
  if (search.query) {
    clauses.push("(name LIKE ? OR slug LIKE ? OR description LIKE ?)");
    const query = `%${search.query}%`;
    values.push(query, query, query);
  }

  const result = await db
    .prepare(`SELECT * FROM agents WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`)
    .bind(...values, search.limit)
    .all<AgentRow>();
  return (result.results ?? []).map(toAgentRegistration);
}

export async function getAgent(db: D1Database, userId: string, id: string): Promise<AgentRegistration | null> {
  const [systemKey, userKey] = readableOwnerKeys(userId);
  const row = await db
    .prepare("SELECT * FROM agents WHERE id = ? AND owner_key IN (?, ?)")
    .bind(id, systemKey, userKey)
    .first<AgentRow>();
  return row ? toAgentRegistration(row) : null;
}

export async function saveAgentRegistration(db: D1Database, agent: AgentRegistration): Promise<AgentRegistration> {
  try {
    await db
      .prepare(
        `INSERT INTO agents (
          id, owner_type, owner_user_id, owner_key, name, slug, description,
          origin, status, version, runtime_type, definition_ref,
          capability_summary, schedule_enabled, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(id, owner_key) DO UPDATE SET
          name = excluded.name,
          slug = excluded.slug,
          description = excluded.description,
          origin = excluded.origin,
          status = excluded.status,
          version = excluded.version,
          runtime_type = excluded.runtime_type,
          definition_ref = excluded.definition_ref,
          capability_summary = excluded.capability_summary,
          schedule_enabled = excluded.schedule_enabled,
          metadata = excluded.metadata,
          updated_at = datetime('now')`,
      )
      .bind(
        agent.id,
        agent.ownerType,
        agent.ownerUserId ?? null,
        agent.ownerKey,
        agent.name,
        agent.slug,
        agent.description,
        agent.origin,
        agent.status,
        agent.version,
        agent.runtimeType,
        agent.definitionRef,
        stringifyJson(agent.capabilitySummary),
        Number(agent.scheduleEnabled),
        stringifyJson(agent.metadata),
      )
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) throw conflict("Agent id or slug already exists for this owner.");
    throw error;
  }

  const saved = await getAgent(db, agent.ownerUserId ?? "system", agent.id);
  if (!saved) throw new Error("Failed to reload saved agent registration.");
  return saved;
}

export async function deleteAgent(db: D1Database, userId: string, id: string): Promise<boolean> {
  const [systemKey, userKey] = readableOwnerKeys(userId);
  const result = await db.prepare("DELETE FROM agents WHERE id = ? AND owner_key IN (?, ?)").bind(id, systemKey, userKey).run();
  return result.meta.changes > 0;
}

function toAgentRegistration(row: AgentRow): AgentRegistration {
  return {
    id: String(row.id),
    ownerType: row.owner_type as AgentRegistration["ownerType"],
    ownerUserId: row.owner_user_id ? String(row.owner_user_id) : undefined,
    ownerKey: String(row.owner_key),
    name: String(row.name),
    slug: String(row.slug),
    description: String(row.description ?? ""),
    origin: row.origin as AgentRegistration["origin"],
    status: row.status as AgentRegistration["status"],
    version: String(row.version),
    runtimeType: row.runtime_type as AgentRegistration["runtimeType"],
    definitionRef: String(row.definition_ref),
    capabilitySummary: parseJson<AgentCapabilitySummary>(row.capability_summary, {
      mcpServers: [],
      skills: [],
      nativeTools: [],
      memoryScopes: [],
    }),
    scheduleEnabled: Boolean(row.schedule_enabled),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
