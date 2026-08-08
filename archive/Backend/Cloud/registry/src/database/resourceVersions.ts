import { stringifyJson } from "../system/json";

export type VersionedResourceKind = "skill" | "mcp-server";

export async function recordResourceVersion(
  db: D1Database,
  input: {
    kind: VersionedResourceKind;
    resourceId: string;
    ownerType: "system" | "user";
    ownerKey: string;
    version: string;
    configRef?: string;
    metadata: Record<string, unknown>;
    changeNote?: string;
  },
): Promise<void> {
  const table = input.kind === "skill" ? "skill_versions" : "mcp_server_versions";
  const idColumn = input.kind === "skill" ? "skill_id" : "mcp_server_id";

  await db.prepare(
    `INSERT INTO ${table} (${idColumn}, owner_type, owner_key, version, config_ref, metadata, change_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(${idColumn}, owner_type, owner_key, version) DO UPDATE SET
       config_ref = excluded.config_ref,
       metadata = excluded.metadata,
       change_note = excluded.change_note`,
  )
    .bind(
      input.resourceId,
      input.ownerType,
      input.ownerKey,
      input.version,
      input.configRef ?? null,
      stringifyJson(input.metadata),
      input.changeNote ?? null,
    )
    .run();
}
