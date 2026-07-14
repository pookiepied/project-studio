import { Hono } from "hono";
import { invalidateContextCache } from "../../cache/contextCache";
import type { Env } from "../../system/env";

export const cacheRoute = new Hono<{ Bindings: Env }>();

cacheRoute.post("/invalidate", async (c) => {
  const authenticatedUserId = c.req.header("x-user-id") ?? c.req.header("X-User-ID");
  if (!authenticatedUserId) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{
    userId: string;
    workspaceId?: string;
    agentId?: string;
    conversationId?: string;
  }>();
  if (body.userId !== authenticatedUserId) return c.json({ error: "forbidden" }, 403);

  const prefix = [
    "context-engine:v1",
    body.userId,
    body.workspaceId ?? "system-workspace",
    body.agentId ?? "main-agent",
    body.conversationId,
  ].filter(Boolean).join(":");

  return c.json({ invalidated: invalidateContextCache(prefix), prefix });
});
