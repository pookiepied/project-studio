import { Hono } from "hono";
import type { ConnectorConnectionRow, Env } from "../types";
import { serializeConnection } from "../database/records";
import { errorResponse } from "../errors";
import { userIdFromRequest } from "../http/request";
import { getComposioToolkit } from "../providers/composio/client";
import { getComposioAppCatalog } from "../providers/composio/catalog";

export const appRoutes = new Hono<{ Bindings: Env }>();

appRoutes.get("/apps", async (c) => {
  try {
    const userId = userIdFromRequest(c.req.raw);
    const search = c.req.query("search")?.trim().toLowerCase();
    const catalog = getComposioAppCatalog(c.env);

    let connections = new Map<string, ReturnType<typeof serializeConnection>>();
    if (userId) {
      const { results } = await c.env.CONNECTORS_DB
        .prepare("SELECT * FROM connector_connections WHERE user_id = ? AND provider_key = 'composio'")
        .bind(userId)
        .all<ConnectorConnectionRow>();
      connections = new Map((results ?? []).map((row) => [row.app_key, serializeConnection(row)]));
    }

    const enriched = await Promise.all(catalog.map(async (app) => {
      try {
        const toolkit = await getComposioToolkit(c.env, app.toolkitSlug);
        return {
          ...app,
          name: toolkit.name ?? app.name,
          description: toolkit.description ?? toolkit.meta?.description ?? app.description,
          categories: toolkit.categories ?? toolkit.meta?.categories ?? app.categories,
          logo: toolkit.logo ?? toolkit.logo_url ?? toolkit.icon ?? toolkit.meta?.logo ?? toolkit.meta?.logo_url ?? app.logo,
        };
      } catch {
        return app;
      }
    }));

    const items = enriched
      .filter((app) => {
        if (!search) return true;
        return `${app.name} ${app.appKey} ${app.description} ${app.categories.join(" ")}`.toLowerCase().includes(search);
      })
      .map((app) => ({
        appId: app.appKey,
        appKey: app.appKey,
        toolkitSlug: app.toolkitSlug,
        name: app.name,
        description: app.description,
        categories: app.categories,
        curatedCategory: app.curatedCategory,
        logo: app.logo,
        configured: Boolean(app.authConfigId),
        connection: connections.get(app.appKey) ?? null,
      }));

    return c.json({ items, totalCount: items.length, totalPages: 1 });
  } catch (err) {
    return errorResponse(err);
  }
});
