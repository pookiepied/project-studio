import type { ConnectorConnectionRow, ConnectorPermissionRow } from "../types";
import { parseJson } from "../http/request";

export function serializeConnection(row: ConnectorConnectionRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    provider_key: row.provider_key,
    app_key: row.app_key,
    display_name: row.display_name,
    entity_id: row.entity_id,
    status: row.status,
    scopes: parseJson<string[]>(row.scopes_json, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    has_credentials: Boolean(row.encrypted_credentials && row.credentials_nonce),
    tools_fetched_at: row.tools_fetched_at,
    auth_expires_at: row.auth_expires_at,
    last_status_checked_at: row.last_status_checked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function serializePermission(row: ConnectorPermissionRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    provider_key: row.provider_key,
    app_key: row.app_key,
    enabled: row.enabled === 1,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function audit(
  db: D1Database,
  userId: string,
  providerKey: string,
  appKey: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO connector_audit_events (user_id, provider_key, app_key, action, metadata_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(userId, providerKey, appKey, action, JSON.stringify(metadata))
    .run();
}
