import { Hono } from "hono";
import type { ConnectorPermissionRow, Env, UpdatePermissionBody } from "../types";
import { serializePermission } from "../database/records";
import { connectorError, errorResponse } from "../errors";
import { requireUser } from "../http/auth";
import { normalizeKey, readJson } from "../http/request";
import { auditPermissionUpdate } from "../services/permissions";

export const permissionRoutes = new Hono<{ Bindings: Env }>();

permissionRoutes.get("/permissions", async (c) => {
  try {
    const userId = requireUser(c.req.raw);

    const { results } = await c.env.CONNECTORS_DB
      .prepare("SELECT * FROM connector_permissions WHERE user_id = ? ORDER BY provider_key, app_key")
      .bind(userId)
      .all<ConnectorPermissionRow>();

    return c.json({ permissions: (results ?? []).map(serializePermission) });
  } catch (err) {
    return errorResponse(err);
  }
});

permissionRoutes.put("/permissions/:providerKey/:appKey", async (c) => {
  try {
    const userId = requireUser(c.req.raw);
    const body = await readJson<UpdatePermissionBody>(c.req.raw);
    if (!body) throw connectorError("bad_request", "Invalid JSON body");

    const providerKey = normalizeKey(c.req.param("providerKey"));
    const appKey = normalizeKey(c.req.param("appKey"));
    const enabled = body.enabled !== false;

    await c.env.CONNECTORS_DB
      .prepare(
        `INSERT INTO connector_permissions (user_id, provider_key, app_key, enabled, metadata_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, provider_key, app_key) DO UPDATE SET
           enabled = excluded.enabled,
           metadata_json = excluded.metadata_json,
           updated_at = unixepoch()`,
      )
      .bind(
        userId,
        providerKey,
        appKey,
        enabled ? 1 : 0,
        JSON.stringify(body.metadata ?? {}),
      )
      .run();

    await auditPermissionUpdate(c.env.CONNECTORS_DB, userId, providerKey, appKey, enabled);

    const row = await c.env.CONNECTORS_DB
      .prepare("SELECT * FROM connector_permissions WHERE user_id = ? AND provider_key = ? AND app_key = ?")
      .bind(userId, providerKey, appKey)
      .first<ConnectorPermissionRow>();

    return c.json({ permission: row ? serializePermission(row) : null });
  } catch (err) {
    return errorResponse(err);
  }
});
