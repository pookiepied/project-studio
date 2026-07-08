import type { ConnectorConnectionRow, Env } from "../types";
import { audit } from "../database/records";
import { connectorError } from "../errors";
import {
  fetchComposioTools,
  getComposioConnectedAccount,
  mapComposioStatus,
} from "../providers/composio/client";
import { getComposioAppConfig } from "../providers/composio/catalog";

function cacheTtl(env: Env): number {
  const parsed = Number(env.CONNECTORS_TOOL_CACHE_TTL_SECONDS ?? "21600");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 21600;
}

function isToolCacheFresh(row: ConnectorConnectionRow, env: Env): boolean {
  if (!row.tools_fetched_at) return false;
  return Math.floor(Date.now() / 1000) - row.tools_fetched_at < cacheTtl(env);
}

export async function syncComposioConnection(
  env: Env,
  userId: string,
  connection: ConnectorConnectionRow,
  options: { forceTools?: boolean } = {},
): Promise<ConnectorConnectionRow> {
  if (!connection.external_account_id) return connection;

  const account = await getComposioConnectedAccount(env, connection.external_account_id);
  if (account.user_id && account.user_id !== userId) {
    throw connectorError("forbidden", "Connected account belongs to a different user", {
      provider: "composio",
      connected_account_id: connection.external_account_id,
    });
  }

  const status = mapComposioStatus(account.status);
  let toolsJson = connection.tools_json;
  let toolsFetchedAt = connection.tools_fetched_at;

  if (status === "active" && (options.forceTools || !isToolCacheFresh(connection, env))) {
    const app = getComposioAppConfig(env, connection.app_key);
    const actions = await fetchComposioTools(env, app?.toolkitSlug ?? connection.app_key);
    toolsJson = JSON.stringify(actions);
    toolsFetchedAt = Math.floor(Date.now() / 1000);
  }

  const now = Math.floor(Date.now() / 1000);
  await env.CONNECTORS_DB
    .prepare(
      `UPDATE connector_connections SET
         status = ?,
         metadata_json = ?,
         tools_json = ?,
         tools_fetched_at = ?,
         auth_expires_at = ?,
         last_status_checked_at = ?,
         updated_at = unixepoch()
       WHERE id = ? AND user_id = ?`,
    )
    .bind(
      status,
      JSON.stringify({
        composio_status: account.status,
        composio_status_reason: account.status_reason,
        auth_config_id: account.auth_config?.id,
        toolkit_slug: account.toolkit?.slug,
      }),
      toolsJson,
      toolsFetchedAt,
      account.state?.val?.expired_at ?? null,
      now,
      connection.id,
      userId,
    )
    .run();

  await audit(env.CONNECTORS_DB, userId, "composio", connection.app_key, "connection.sync", {
    status,
    force_tools: options.forceTools === true,
  });

  const updated = await env.CONNECTORS_DB
    .prepare("SELECT * FROM connector_connections WHERE id = ? AND user_id = ?")
    .bind(connection.id, userId)
    .first<ConnectorConnectionRow>();

  return updated ?? connection;
}
