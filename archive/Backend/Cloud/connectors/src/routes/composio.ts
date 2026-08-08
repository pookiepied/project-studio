import { Hono } from "hono";
import type { ComposioConnectBody, ConnectorConnectionRow, Env } from "../types";
import { audit, serializeConnection } from "../database/records";
import { connectorError, errorResponse } from "../errors";
import { requireUser } from "../http/auth";
import { readJson } from "../http/request";
import { encryptJson } from "../security/crypto";
import { syncComposioConnection } from "../services/composioSync";
import { ensurePermission } from "../services/permissions";
import {
  createComposioConnectLink,
  mapComposioStatus,
  refreshComposioConnectedAccount,
} from "../providers/composio/client";
import { getComposioAppConfig } from "../providers/composio/catalog";

export const composioRoutes = new Hono<{ Bindings: Env }>();

composioRoutes.post("/composio/connect", async (c) => {
  try {
    const userId = requireUser(c.req.raw);
    const body = await readJson<ComposioConnectBody>(c.req.raw);
    if (!body?.appKey) throw connectorError("bad_request", "appKey is required");

    const app = getComposioAppConfig(c.env, body.appKey);
    if (!app) throw connectorError("not_found", "This Composio app is not in the curated Studio catalog", { app_key: body.appKey });

    const link = await createComposioConnectLink(c.env, app, {
      userId,
      callbackUrl: body.callbackUrl,
      alias: body.alias ?? `${userId}_${app.appKey}`,
    });

    if (!link.redirect_url) {
      throw connectorError("provider_error", "Composio did not return a redirect URL", { app_key: app.appKey }, 502, true);
    }

    const encryptedLinkToken = link.link_token
      ? await encryptJson(c.env, { link_token: link.link_token })
      : null;

    await c.env.CONNECTORS_DB
      .prepare(
        `INSERT INTO connector_connections (
           user_id, provider_key, app_key, display_name, entity_id, external_account_id,
           status, metadata_json, auth_expires_at, last_status_checked_at
         )
         VALUES (?, 'composio', ?, ?, ?, ?, 'initiated', ?, ?, unixepoch())
         ON CONFLICT(user_id, provider_key, app_key) DO UPDATE SET
           display_name = excluded.display_name,
           entity_id = excluded.entity_id,
           external_account_id = COALESCE(excluded.external_account_id, connector_connections.external_account_id),
           status = 'initiated',
           metadata_json = excluded.metadata_json,
           auth_expires_at = excluded.auth_expires_at,
           last_status_checked_at = unixepoch(),
           updated_at = unixepoch()`,
      )
      .bind(
        userId,
        app.appKey,
        app.name,
        userId,
        link.connected_account_id ?? null,
        JSON.stringify({ auth_config_id: app.authConfigId, toolkit_slug: app.toolkitSlug }),
        link.expires_at ?? null,
      )
      .run();

    await ensurePermission(c.env.CONNECTORS_DB, userId, "composio", app.appKey);

    await c.env.CONNECTORS_DB
      .prepare(
        `INSERT INTO connector_auth_sessions (
           user_id, provider_key, app_key, connection_id, link_token_ciphertext,
           link_token_nonce, redirect_url, callback_url, expires_at
         )
         VALUES (?, 'composio', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        userId,
        app.appKey,
        link.connected_account_id ?? null,
        encryptedLinkToken?.ciphertext ?? null,
        encryptedLinkToken?.nonce ?? null,
        link.redirect_url,
        body.callbackUrl ?? null,
        link.expires_at ?? null,
      )
      .run();

    await audit(c.env.CONNECTORS_DB, userId, "composio", app.appKey, "auth.link.created", {
      connected_account_id: link.connected_account_id,
      expires_at: link.expires_at,
    });

    const row = await c.env.CONNECTORS_DB
      .prepare("SELECT * FROM connector_connections WHERE user_id = ? AND provider_key = 'composio' AND app_key = ?")
      .bind(userId, app.appKey)
      .first<ConnectorConnectionRow>();

    return c.json({
      redirectUrl: link.redirect_url,
      connectionStatus: "INITIATED",
      connection: row ? serializeConnection(row) : null,
      expiresAt: link.expires_at,
    }, 201);
  } catch (err) {
    return errorResponse(err);
  }
});

composioRoutes.post("/connections/:id/sync", async (c) => {
  try {
    const userId = requireUser(c.req.raw);
    const id = c.req.param("id");
    const row = await c.env.CONNECTORS_DB
      .prepare("SELECT * FROM connector_connections WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .first<ConnectorConnectionRow>();
    if (!row) throw connectorError("not_found", "Connection not found");
    if (row.provider_key !== "composio") throw connectorError("bad_request", "Only Composio connections support sync right now");

    const updated = await syncComposioConnection(c.env, userId, row, { forceTools: true });
    return c.json({ connection: serializeConnection(updated) });
  } catch (err) {
    return errorResponse(err);
  }
});

composioRoutes.post("/connections/:id/refresh", async (c) => {
  try {
    const userId = requireUser(c.req.raw);
    const id = c.req.param("id");
    const body = await readJson<{ redirectUrl?: string }>(c.req.raw) ?? {};
    const row = await c.env.CONNECTORS_DB
      .prepare("SELECT * FROM connector_connections WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .first<ConnectorConnectionRow>();
    if (!row) throw connectorError("not_found", "Connection not found");
    if (!row.external_account_id) throw connectorError("bad_request", "Connection does not have a Composio account id yet");

    const refresh = await refreshComposioConnectedAccount(c.env, row.external_account_id, body.redirectUrl);
    await audit(c.env.CONNECTORS_DB, userId, row.provider_key, row.app_key, "connection.refresh", {
      status: refresh.status,
      redirect: Boolean(refresh.redirect_url),
    });

    return c.json({
      id: refresh.id,
      status: mapComposioStatus(refresh.status),
      redirectUrl: refresh.redirect_url,
    });
  } catch (err) {
    return errorResponse(err);
  }
});

composioRoutes.post("/connections/:id/sync-tools", async (c) => {
  try {
    const userId = requireUser(c.req.raw);
    const id = c.req.param("id");
    const row = await c.env.CONNECTORS_DB
      .prepare("SELECT * FROM connector_connections WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .first<ConnectorConnectionRow>();
    if (!row) throw connectorError("not_found", "Connection not found");
    if (row.provider_key !== "composio") throw connectorError("bad_request", "Tool sync is not supported for this provider yet");

    const updated = await syncComposioConnection(c.env, userId, row, { forceTools: true });
    const toolCount = JSON.parse(updated.tools_json || "[]").length;
    return c.json({ synced: true, tool_count: toolCount, tools_fetched_at: updated.tools_fetched_at });
  } catch (err) {
    return errorResponse(err);
  }
});
