import type { RegistrySkillRecord } from "@studio/v2-contracts";

/** User-scoped D1 repository. Skill bodies stay behind instructionsRef. */
export async function listSkills(db: D1Database, userId: string): Promise<RegistrySkillRecord[]> {
  const result = await db.prepare("SELECT * FROM skills WHERE user_id=? ORDER BY name")
    .bind(userId).all<Record<string, unknown>>();
  return (result.results ?? []).map(toRecord);
}

export async function getSkill(db: D1Database, userId: string, id: string): Promise<RegistrySkillRecord | null> {
  const row = await db.prepare("SELECT * FROM skills WHERE user_id=? AND id=?")
    .bind(userId, id).first<Record<string, unknown>>();
  return row ? toRecord(row) : null;
}

export async function upsertSkill(db: D1Database, record: RegistrySkillRecord): Promise<void> {
  await db.prepare(`INSERT INTO skills
    (id,user_id,name,origin,location,version,enabled,available,description,instructions_ref,required_tools,required_permissions,environments,activation_rules,resources,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(id,user_id) DO UPDATE SET name=excluded.name,origin=excluded.origin,location=excluded.location,version=excluded.version,
      enabled=excluded.enabled,available=excluded.available,description=excluded.description,
      instructions_ref=excluded.instructions_ref,required_tools=excluded.required_tools,
      required_permissions=excluded.required_permissions,environments=excluded.environments,
      activation_rules=excluded.activation_rules,resources=excluded.resources,updated_at=datetime('now')`)
    .bind(record.ref.id, record.userId, record.ref.name, record.origin, record.location, record.version ?? "0.1.0",
      Number(record.enabled), Number(record.available), record.description, record.instructionsRef ?? null,
      JSON.stringify(record.requiredTools), JSON.stringify(record.requiredPermissions),
      JSON.stringify(record.environments), JSON.stringify(record.activationRules), JSON.stringify(record.resources))
    .run();
}

export async function deleteSkill(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM skills WHERE user_id=? AND id=?").bind(userId, id).run();
  return result.meta.changes > 0;
}

function toRecord(row: Record<string, unknown>): RegistrySkillRecord {
  return {
    ref: { id: String(row.id), kind: "skill", name: String(row.name) },
    userId: String(row.user_id), origin: row.origin as RegistrySkillRecord["origin"], location: row.location as RegistrySkillRecord["location"],
    enabled: Boolean(row.enabled), available: Boolean(row.available), version: String(row.version),
    permissions: parse(row.required_permissions, []),
    configRef: row.instructions_ref ? String(row.instructions_ref) : undefined,
    metadata: {}, description: String(row.description ?? ""),
    instructionsRef: row.instructions_ref ? String(row.instructions_ref) : undefined,
    requiredTools: parse(row.required_tools, []), requiredPermissions: parse(row.required_permissions, []),
    environments: parse(row.environments, []), activationRules: parse(row.activation_rules, {}),
    resources: parse(row.resources, []),
  };
}

function parse<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value ?? "")) as T; } catch { return fallback; }
}
