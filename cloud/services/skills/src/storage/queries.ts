import type { Env } from "../env";
import type {
  SkillRegistrationRow,
  RegisterLocalInput,
  AuditEntry,
} from "./d1";
import type { SkillRuntime, SkillScope, SkillSourceType, SkillSummary } from "../features/types";

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * Insert a new local skill registration. Each registration is a distinct row —
 * duplicate keys are preserved (not silently merged) so the precedence resolver
 * can surface shadowed skills. `(user_id, key)` collisions are intentional
 * (e.g. the same skill found under two scanned paths); the scanner is expected
 * to deduplicate identical paths before registering.
 */
export async function insertRegistration(
  env: Env,
  input: RegisterLocalInput,
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const scope: SkillScope = input.scope ?? "local";
  const runtime: SkillRuntime = input.allowedRuntime ?? "local";
  const sourceType: SkillSourceType = input.sourceType ?? "local_path";
  const manifestJson = input.manifestJson && input.manifestJson.trim() ? input.manifestJson : "{}";
  const ts = nowSec();

  try {
    await env.SKILLS_DB
      .prepare(
        `INSERT INTO skill_registrations
           (id, user_id, device_id, scope, key, name, description, category, version,
            allowed_runtime, source_type, source_url, local_path, manifest_json,
            content_hash, enabled, last_seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id, input.userId, input.deviceId ?? null, scope, input.key, input.name,
        input.description, input.category ?? null, input.version ?? null,
        runtime, sourceType, input.sourceUrl ?? null, input.localPath ?? null,
        manifestJson, input.contentHash ?? null, input.enabled === false ? 0 : 1,
        ts, ts, ts,
      )
      .run();

    return { id };
  } catch (err) {
    throw new Error(`Failed to register skill: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** All enabled registrations for a user (optionally scoped to a device). */
export async function listRegistrations(
  env: Env,
  userId: string,
  opts: { deviceId?: string | null; includeDisabled?: boolean } = {},
): Promise<SkillRegistrationRow[]> {
  let q = "SELECT * FROM skill_registrations WHERE user_id = ?";
  const params: unknown[] = [userId];
  if (opts.deviceId) { q += " AND (device_id = ? OR device_id IS NULL)"; params.push(opts.deviceId); }
  if (!opts.includeDisabled) q += " AND enabled = 1";
  q += " ORDER BY created_at DESC";

  const { results } = await env.SKILLS_DB.prepare(q).bind(...params).all<SkillRegistrationRow>();
  return results ?? [];
}

/** Remove a registration by user + key. Returns true if a row was deleted. */
export async function unregisterRegistration(
  env: Env,
  userId: string,
  key: string,
  deviceId?: string | null,
): Promise<boolean> {
  const stmt = deviceId
    ? env.SKILLS_DB.prepare(
        "DELETE FROM skill_registrations WHERE user_id = ? AND key = ? AND (device_id = ? OR device_id IS NULL)",
      ).bind(userId, key, deviceId)
    : env.SKILLS_DB.prepare(
        "DELETE FROM skill_registrations WHERE user_id = ? AND key = ?",
      ).bind(userId, key);

  const res = await stmt.run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Mark a skill as recently seen (heartbeat from a local runtime). */
export async function heartbeatRegistration(
  env: Env,
  userId: string,
  key: string,
  deviceId?: string | null,
): Promise<boolean> {
  const ts = nowSec();
  const stmt = deviceId
    ? env.SKILLS_DB.prepare(
        "UPDATE skill_registrations SET last_seen_at = ?, updated_at = ?, enabled = 1 WHERE user_id = ? AND key = ? AND (device_id = ? OR device_id IS NULL)",
      ).bind(ts, ts, userId, key, deviceId)
    : env.SKILLS_DB.prepare(
        "UPDATE skill_registrations SET last_seen_at = ?, updated_at = ?, enabled = 1 WHERE user_id = ? AND key = ?",
      ).bind(ts, ts, userId, key);

  const res = await stmt.run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Append an audit-log row. Never throws — audit failures are swallowed. */
export async function insertAudit(env: Env, entry: AuditEntry): Promise<void> {
  try {
    await env.SKILLS_DB
      .prepare(
        `INSERT INTO skill_audit_log (id, user_id, device_id, skill_key, action, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        entry.userId ?? null,
        entry.deviceId ?? null,
        entry.skillKey ?? null,
        entry.action,
        JSON.stringify(entry.metadata ?? {}),
        nowSec(),
      )
      .run();
  } catch {
    /* audit logging is best-effort */
  }
}

/** Convert a D1 row into a normalized catalog summary. */
export function rowToSummary(row: SkillRegistrationRow): SkillSummary {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category ?? "General",
    version: row.version ?? "0.0.0",
    scope: row.scope,
    allowedRuntime: row.allowed_runtime,
    sourceType: row.source_type,
    bundled: false,
    localPath: row.local_path,
    sourceUrl: row.source_url,
    deviceId: row.device_id,
    // Cloud caller cannot read local-only content. A desktop/local runtime can
    // read `${localPath}/SKILL.md` through Computer Use skill_read_local or
    // Studio Harness read_file. Never claim cloud-readability of local files.
    contentReadable: false,
  };
}
