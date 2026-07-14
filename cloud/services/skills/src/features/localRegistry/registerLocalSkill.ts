import { insertRegistration, unregisterRegistration, heartbeatRegistration, listRegistrations, rowToSummary } from "../../storage/queries";
import { validateManifest } from "../validate/validateManifest";
import { auditLog } from "../audit/auditLog";
import type { Env } from "../../env";
import type { SkillSummary } from "../types";
import type { RegisterLocalInput } from "../../storage/d1";
import type { SkillRegistrationRow } from "../../storage/d1";

/** Register a local skill manifest. Metadata only — no content upload. */
export async function registerLocalSkill(
  env: Env,
  input: RegisterLocalInput,
): Promise<{ id: string }> {
  if (!input.userId || !input.key || !input.name || !input.description) {
    throw new Error("userId, key, name, and description are required");
  }

  // Validate the manifest block if one was supplied.
  if (input.manifestJson && input.manifestJson.trim() !== "{}") {
    try {
      const parsed = JSON.parse(input.manifestJson);
      const r = validateManifest(parsed);
      if (!r.valid) throw new Error(`Invalid manifest: ${r.errors.join("; ")}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Invalid manifest")) throw e;
      throw new Error(`manifestJson is not valid JSON`);
    }
  }

  const res = await insertRegistration(env, input);
  await auditLog(env, {
    userId: input.userId,
    deviceId: input.deviceId ?? null,
    skillKey: input.key,
    action: "register_local",
    metadata: { id: res.id, sourceType: input.sourceType ?? "local_path", localPath: input.localPath ?? null },
  });
  return res;
}

/** Remove a local skill registration. */
export async function unregisterLocalSkill(
  env: Env,
  userId: string,
  key: string,
  deviceId?: string | null,
): Promise<boolean> {
  const removed = await unregisterRegistration(env, userId, key, deviceId);
  await auditLog(env, {
    userId, deviceId: deviceId ?? null, skillKey: key,
    action: "unregister_local",
    metadata: { removed },
  });
  return removed;
}

/** Mark a local skill as recently seen (alive heartbeat). */
export async function heartbeatLocalSkill(
  env: Env,
  userId: string,
  key: string,
  deviceId?: string | null,
): Promise<boolean> {
  const touched = await heartbeatRegistration(env, userId, key, deviceId);
  await auditLog(env, {
    userId, deviceId: deviceId ?? null, skillKey: key,
    action: "heartbeat_local",
    metadata: { touched },
  });
  return touched;
}

/** List local registrations for a user as catalog summaries (metadata only). */
export async function listLocalRegistrations(
  env: Env,
  userId: string,
  deviceId?: string | null,
): Promise<SkillSummary[]> {
  const rows: SkillRegistrationRow[] = await listRegistrations(env, userId, { deviceId, includeDisabled: false });
  return rows.map(rowToSummary);
}
