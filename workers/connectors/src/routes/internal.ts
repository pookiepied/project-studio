import { Hono } from "hono";
import type { ComposioAction, ConnectorConnectionRow, ConnectorPermissionRow, Env } from "../types";
import { executeComposioAction } from "../providers/composio/client";
import { errorResponse, connectorError } from "../errors";
import { parseJson, readJson } from "../http/request";

export const internalRoutes = new Hono<{ Bindings: Env }>();

function appEnabled(permission: ConnectorPermissionRow | null): boolean {
  return !permission || permission.enabled === 1;
}

function toToolName(appKey: string, action: ComposioAction): string {
  return `composio_${appKey.toLowerCase()}__${action.slug.toLowerCase()}`;
}

function inputSchema(action: ComposioAction): Record<string, unknown> {
  return action.input_parameters ?? action.inputParameters ?? { type: "object", properties: {} };
}

internalRoutes.get("/internal/catalog", async (c) => {
  try {
    const userId = c.req.query("userId");
    if (!userId) throw connectorError("bad_request", "userId is required");

    const { results: connections } = await c.env.CONNECTORS_DB
      .prepare(
        `SELECT * FROM connector_connections
         WHERE user_id = ? AND status = 'active'
         ORDER BY provider_key, app_key`,
      )
      .bind(userId)
      .all<ConnectorConnectionRow>();

    const connectors = [];
    for (const row of connections ?? []) {
      const permission = await c.env.CONNECTORS_DB
        .prepare("SELECT * FROM connector_permissions WHERE user_id = ? AND provider_key = ? AND app_key = ?")
        .bind(userId, row.provider_key, row.app_key)
        .first<ConnectorPermissionRow>();

      if (!appEnabled(permission)) continue;

      const actions = parseJson<ComposioAction[]>(row.tools_json, []);
      connectors.push({
        providerKey: row.provider_key,
        appKey: row.app_key,
        displayName: row.display_name || row.app_key,
        status: row.status,
        toolCount: actions.length,
        toolsFetchedAt: row.tools_fetched_at,
      });
    }

    return c.json({
      summary: {
        connectedConnectorCount: connectors.length,
        totalToolCount: connectors.reduce((sum, item) => sum + item.toolCount, 0),
      },
      connectors,
    });
  } catch (err) {
    return errorResponse(err);
  }
});

internalRoutes.get("/internal/tools/composio", async (c) => {
  try {
    const userId = c.req.query("userId");
    if (!userId) throw connectorError("bad_request", "userId is required");

    const { results: connections } = await c.env.CONNECTORS_DB
      .prepare(
        `SELECT * FROM connector_connections
         WHERE user_id = ? AND provider_key = 'composio' AND status = 'active'
         ORDER BY app_key`,
      )
      .bind(userId)
      .all<ConnectorConnectionRow>();

    const allTools: {
      slug: string;
      name: string;
      description: string;
      inputParameters: Record<string, unknown>;
      connectionId: string;
      entityId: string;
      appKey: string;
      displayName: string;
    }[] = [];
    const apps: { appName: string; displayName: string; tools: { name: string; description: string }[] }[] = [];

    for (const row of connections ?? []) {
      if (!row.external_account_id) continue;

      const permission = await c.env.CONNECTORS_DB
        .prepare("SELECT * FROM connector_permissions WHERE user_id = ? AND provider_key = ? AND app_key = ?")
        .bind(userId, row.provider_key, row.app_key)
        .first<ConnectorPermissionRow>();
      if (!appEnabled(permission)) continue;

      const actions = parseJson<ComposioAction[]>(row.tools_json, []);
      const appTools: { name: string; description: string }[] = [];

      for (const action of actions) {
        if (!action.slug || !action.name) continue;

        const toolName = toToolName(row.app_key, action);
        const description = action.description ?? action.name;

        allTools.push({
          slug: action.slug,
          name: toolName,
          description,
          inputParameters: inputSchema(action),
          connectionId: row.external_account_id,
          entityId: row.entity_id,
          appKey: row.app_key,
          displayName: row.display_name || row.app_key,
        });
        appTools.push({ name: toolName, description });
      }

      if (appTools.length > 0) {
        apps.push({ appName: row.app_key, displayName: row.display_name || row.app_key, tools: appTools });
      }
    }

    return c.json({ tools: allTools, apps });
  } catch (err) {
    return errorResponse(err);
  }
});

internalRoutes.post("/internal/composio/execute", async (c) => {
  try {
    const body = await readJson<{
      userId?: string;
      slug?: string;
      connectionId?: string;
      entityId?: string;
      args?: unknown;
    }>(c.req.raw);

    if (!body) throw connectorError("bad_request", "Invalid JSON body");
    if (!body.userId || !body.slug || !body.connectionId || !body.entityId) {
      throw connectorError("bad_request", "userId, slug, connectionId, and entityId are required");
    }

    const row = await c.env.CONNECTORS_DB
      .prepare(
        `SELECT * FROM connector_connections
         WHERE user_id = ? AND provider_key = 'composio' AND external_account_id = ? AND entity_id = ? AND status = 'active'`,
      )
      .bind(body.userId, body.connectionId, body.entityId)
      .first<ConnectorConnectionRow>();

    if (!row) throw connectorError("not_found", "Connection not found or inactive");

    const permission = await c.env.CONNECTORS_DB
      .prepare("SELECT * FROM connector_permissions WHERE user_id = ? AND provider_key = ? AND app_key = ?")
      .bind(body.userId, row.provider_key, row.app_key)
      .first<ConnectorPermissionRow>();
    if (!appEnabled(permission)) {
      throw connectorError("forbidden", "This connector is disabled for the user", {
        provider_key: row.provider_key,
        app_key: row.app_key,
      });
    }

    const actions = parseJson<ComposioAction[]>(row.tools_json, []);
    const action = actions.find((item) => item.slug?.toLowerCase() === body.slug!.toLowerCase());
    if (!action) {
      throw connectorError("not_found", "Tool is not available for this connection", {
        provider_key: row.provider_key,
        app_key: row.app_key,
        slug: body.slug,
      });
    }

    const data = await executeComposioAction(c.env, {
      slug: body.slug,
      connectedAccountId: body.connectionId,
      entityId: body.entityId,
      args: body.args,
    });
    return c.json({ success: true, data });
  } catch (err) {
    return errorResponse(err);
  }
});
