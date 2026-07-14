import { Hono } from "hono";
import type { RuntimeConsumer } from "../../contracts";
import { assembleContext } from "../../assembly/assemble";
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
    "context-engine:capabilities:v1",
    body.userId,
    body.workspaceId ?? "system-workspace",
    body.agentId ?? "main-agent",
  ].filter(Boolean).join(":");

  return c.json({ invalidated: invalidateContextCache(prefix), prefix });
});

cacheRoute.post("/warm", async (c) => {
  const authenticatedUserId = c.req.header("x-user-id") ?? c.req.header("X-User-ID");
  if (!authenticatedUserId) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{
    userId: string;
    workspaceId?: string;
    agentId?: string;
    consumer?: RuntimeConsumer;
  }>();
  if (body.userId !== authenticatedUserId) return c.json({ error: "forbidden" }, 403);

  const context = await assembleContext(c.env, {
    userId: body.userId,
    workspaceId: body.workspaceId,
    agentId: body.agentId,
    taskId: "cache-warm",
    task: "",
    consumer: body.consumer ?? "execution",
  });

  return c.json({
    warmed: true,
    cacheKey: context.contextEngine.cacheKey,
    cacheStatus: context.contextEngine.cacheStatus,
    capabilityCount: context.internal.capabilityCount,
    toolCount: context.internal.toolCount,
  });
});
