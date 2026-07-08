import { audit } from "../database/records";

export async function ensurePermission(
  db: D1Database,
  userId: string,
  providerKey: string,
  appKey: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO connector_permissions (user_id, provider_key, app_key)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, provider_key, app_key) DO NOTHING`,
    )
    .bind(userId, providerKey, appKey)
    .run();
}

export async function auditPermissionUpdate(
  db: D1Database,
  userId: string,
  providerKey: string,
  appKey: string,
  enabled: boolean,
): Promise<void> {
  await audit(db, userId, providerKey, appKey, "permission.update", { enabled });
}
