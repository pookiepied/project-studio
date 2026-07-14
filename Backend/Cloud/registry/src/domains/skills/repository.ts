import { recordResourceVersion } from "../../database/resourceVersions";
import { conflict } from "../../errors/appError";
import { parseJson, stringifyJson } from "../../system/json";
import { readableOwnerKeys } from "../../system/ownership";
import type { SkillRecord, SkillSearch } from "./types";

type SkillRow = Record<string, unknown>;

export async function listSkills(db: D1Database, search: SkillSearch): Promise<SkillRecord[]> {
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
    .prepare(`SELECT * FROM skills WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`)
    .bind(...values, search.limit)
    .all<SkillRow>();
  return (result.results ?? []).map(toSkill);
}

export async function getSkill(db: D1Database, userId: string, id: string): Promise<SkillRecord | null> {
  const [systemKey, userKey] = readableOwnerKeys(userId);
  const row = await db
    .prepare("SELECT * FROM skills WHERE id = ? AND owner_key IN (?, ?)")
    .bind(id, systemKey, userKey)
    .first<SkillRow>();
  return row ? toSkill(row) : null;
}

export async function saveSkill(db: D1Database, skill: SkillRecord, changeNote?: string): Promise<SkillRecord> {
  try {
    await db
      .prepare(
        `INSERT INTO skills (
          id, owner_type, owner_user_id, owner_key, name, slug, description, origin, status, current_version,
          instructions_ref, config_ref, tags, metadata, activation_rules,
          required_tools, required_permissions, resources, mcp_server_ids,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(id, owner_key) DO UPDATE SET
          name = excluded.name,
          slug = excluded.slug,
          description = excluded.description,
          origin = excluded.origin,
          status = excluded.status,
          current_version = excluded.current_version,
          instructions_ref = excluded.instructions_ref,
          config_ref = excluded.config_ref,
          tags = excluded.tags,
          metadata = excluded.metadata,
          activation_rules = excluded.activation_rules,
          required_tools = excluded.required_tools,
          required_permissions = excluded.required_permissions,
          resources = excluded.resources,
          mcp_server_ids = excluded.mcp_server_ids,
          updated_at = datetime('now')`,
      )
      .bind(
        skill.id,
        skill.ownerType,
        skill.ownerUserId ?? null,
        skill.ownerKey,
        skill.name,
        skill.slug,
        skill.description,
        skill.origin,
        skill.status,
        skill.currentVersion,
        skill.instructionsRef,
        skill.configRef ?? null,
        stringifyJson(skill.tags),
        stringifyJson(skill.metadata),
        stringifyJson(skill.activationRules),
        stringifyJson(skill.requiredTools),
        stringifyJson(skill.requiredPermissions),
        stringifyJson(skill.resources),
        stringifyJson(skill.mcpServerIds),
      )
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) throw conflict("Skill id or slug already exists for this owner.");
    throw error;
  }

  await recordResourceVersion(db, {
    kind: "skill",
    resourceId: skill.id,
    ownerType: skill.ownerType,
    ownerKey: skill.ownerKey,
    version: skill.currentVersion,
    configRef: skill.configRef ?? skill.instructionsRef,
    metadata: { name: skill.name, slug: skill.slug, status: skill.status },
    changeNote,
  });

  const saved = await getSkill(db, skill.ownerUserId ?? "system", skill.id);
  if (!saved) throw new Error("Failed to reload saved skill.");
  return saved;
}

export async function deleteSkill(db: D1Database, userId: string, id: string): Promise<boolean> {
  const [systemKey, userKey] = readableOwnerKeys(userId);
  const result = await db.prepare("DELETE FROM skills WHERE id = ? AND owner_key IN (?, ?)").bind(id, systemKey, userKey).run();
  return result.meta.changes > 0;
}

function toSkill(row: SkillRow): SkillRecord {
  return {
    id: String(row.id),
    ownerType: row.owner_type as SkillRecord["ownerType"],
    ownerUserId: row.owner_user_id ? String(row.owner_user_id) : undefined,
    ownerKey: String(row.owner_key),
    name: String(row.name),
    slug: String(row.slug),
    description: String(row.description ?? ""),
    origin: row.origin as SkillRecord["origin"],
    status: row.status as SkillRecord["status"],
    currentVersion: String(row.current_version),
    instructionsRef: String(row.instructions_ref),
    configRef: row.config_ref ? String(row.config_ref) : undefined,
    tags: parseJson<string[]>(row.tags, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    activationRules: parseJson<Record<string, unknown>>(row.activation_rules, {}),
    requiredTools: parseJson<string[]>(row.required_tools, []),
    requiredPermissions: parseJson<string[]>(row.required_permissions, []),
    resources: parseJson<unknown[]>(row.resources, []),
    mcpServerIds: parseJson<string[]>(row.mcp_server_ids, []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
