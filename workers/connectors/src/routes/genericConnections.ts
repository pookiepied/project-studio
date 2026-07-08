import { Hono } from "hono";
import type { ConnectorConnectionRow, Env, UpsertConnectionBody } from "../types";
import { audit, serializeConnection } from "../database/records";
import { connectorError, errorResponse } from "../errors";
import { requireUser } from "../http/auth";
import { normalizeKey, readJson } from "../http/request";
import { encryptJson } from "../security/crypto";
import { revokeComposioConnectedAccount } from "../providers/composio/client";
import { ensurePermission } from "../services/permissions";

export const genericConnectionRoutes = new Hono<{ Bindings: Env }>();

genericConnectionRoutes.get("/connections", async (c) => {
  try {
    const userId = requireUser(c.req.raw);
    const providerKey = c.req.query("provider_key");
    const appKey = c.req.query("app_key");

    let sql = "SELECT * FROM connector_connections WHERE user_id = ?";
    const binds: unknown[] = [userId];

    if (providerKey) {
      sql += " AND provider_key = ?";
      binds.push(normalizeKey(providerKey));
    }
    if (appKey) {
      sql += " AND app_key = ?";
      binds.push(normalizeKey(appKey));
    }
    sql += " ORDER BY provider_key, app_key";

    const { results } = await c.env.CONNECTORS_DB.prepare(sql).bind(...binds).all<ConnectorConnectionRow>();
    return c.json({ connections: (results ?? []).map(serializeConnection) });
  } catch (err) {
    return errorResponse(err);
  }
});

genericConnectionRoutes.post("/connections", async (c) => {
  try {
    const userId = requireUser(c.req.raw);
    const body = await readJson<UpsertConnectionBody>(c.req.raw);
    if (!body) throw connectorError("bad_request", "Invalid JSON body");
    if (!body.provider_key || !body.app_key) {
      throw connectorError("bad_request", "provider_key and app_key are required");
    }

    const providerKey = normalizeKey(body.provider_key);
    const appKey = normalizeKey(body.app_key);
    const entityId = body.entity_id?.trim() || userId;
    const status = body.status ?? (body.external_account_id ? "active" : "initiated");
    const displayName = body.display_name?.trim() || appKey;

    let encryptedCredentials: string | null = null;
    let credentialsNonce: string | null = null;
    if (body.credentials) {
      const encrypted = await encryptJson(c.env, body.credentials);
      encryptedCredentials = encrypted.ciphertext;
      credentialsNonce = encrypted.nonce;
    }

    await c.env.CONNECTORS_DB
      .prepare(
        `INSERT INTO connector_connections (
           user_id, provider_key, app_key, display_name, entity_id, external_account_id,
           status, scopes_json, metadata_json, encrypted_credentials, credentials_nonce
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, provider_key, app_key) DO UPDATE SET
           display_name = excluded.display_name,
           entity_id = excluded.entity_id,
           external_account_id = COALESCE(excluded.external_account_id, connector_connections.external_account_id),
           status = excluded.status,
           scopes_json = excluded.scopes_json,
           metadata_json = excluded.metadata_json,
           encrypted_credentials = COALESCE(excluded.encrypted_credentials, connector_connections.encrypted_credentials),
           credentials_nonce = COALESCE(excluded.credentials_nonce, connector_connections.credentials_nonce),
           updated_at = unixepoch()`,
      )
      .bind(
        userId,
        providerKey,
        appKey,
        displayName,
        entityId,
        body.external_account_id ?? null,
        status,
        JSON.stringify(body.scopes ?? []),
        JSON.stringify(body.metadata ?? {}),
        encryptedCredentials,
        credentialsNonce,
      )
      .run();

    await ensurePermission(c.env.CONNECTORS_DB, userId, providerKey, appKey);
    await audit(c.env.CONNECTORS_DB, userId, providerKey, appKey, "connection.upsert", { status });

    const row = await c.env.CONNECTORS_DB
      .prepare("SELECT * FROM connector_connections WHERE user_id = ? AND provider_key = ? AND app_key = ?")
      .bind(userId, providerKey, appKey)
      .first<ConnectorConnectionRow>();

    return c.json({ connection: row ? serializeConnection(row) : null });
  } catch (err) {
    return errorResponse(err);
  }
});

genericConnectionRoutes.patch("/connections/:id", async (c) => {
  try {
    const userId = requireUser(c.req.raw);
    const id = c.req.param("id");
    const body = await readJson<UpsertConnectionBody>(c.req.raw);
    if (!body) throw connectorError("bad_request", "Invalid JSON body");

    const existing = await c.env.CONNECTORS_DB
      .prepare("SELECT * FROM connector_connections WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .first<ConnectorConnectionRow>();
    if (!existing) throw connectorError("not_found", "Connection not found");

    let encryptedCredentials = existing.encrypted_credentials;
    let credentialsNonce = existing.credentials_nonce;
    if (body.credentials) {
      const encrypted = await encryptJson(c.env, body.credentials);
      encryptedCredentials = encrypted.ciphertext;
      credentialsNonce = encrypted.nonce;
    }

    await c.env.CONNECTORS_DB
      .prepare(
        `UPDATE connector_connections SET
           display_name = ?,
           external_account_id = ?,
           status = ?,
           scopes_json = ?,
           metadata_json = ?,
           encrypted_credentials = ?,
           credentials_nonce = ?,
           updated_at = unixepoch()
         WHERE id = ? AND user_id = ?`,
      )
      .bind(
        body.display_name ?? existing.display_name,
        body.external_account_id ?? existing.external_account_id,
        body.status ?? existing.status,
        JSON.stringify(body.scopes ?? JSON.parse(existing.scopes_json || "[]")),
        JSON.stringify(body.metadata ?? JSON.parse(existing.metadata_json || "{}")),
        encryptedCredentials,
        credentialsNonce,
        id,
        userId,
      )
      .run();

    await audit(c.env.CONNECTORS_DB, userId, existing.provider_key, existing.app_key, "connection.patch");

    const row = await c.env.CONNECTORS_DB
      .prepare("SELECT * FROM connector_connections WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .first<ConnectorConnectionRow>();

    return c.json({ connection: row ? serializeConnection(row) : null });
  } catch (err) {
    return errorResponse(err);
  }
});

genericConnectionRoutes.delete("/connections/:id", async (c) => {
  try {
    const userId = requireUser(c.req.raw);
    const id = c.req.param("id");
    const existing = await c.env.CONNECTORS_DB
      .prepare("SELECT * FROM connector_connections WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .first<ConnectorConnectionRow>();
    if (!existing) throw connectorError("not_found", "Connection not found");

    if (existing.provider_key === "composio" && existing.external_account_id) {
      await revokeComposioConnectedAccount(c.env, existing.external_account_id);
    }

    await c.env.CONNECTORS_DB
      .prepare("DELETE FROM connector_connections WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .run();

    await audit(c.env.CONNECTORS_DB, userId, existing.provider_key, existing.app_key, "connection.delete");
    return c.json({ deleted: true, id });
  } catch (err) {
    return errorResponse(err);
  }
});
