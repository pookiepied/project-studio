import { Hono } from "hono";
import type { ExpandToolRequest } from "../../contracts";
import { expandTool } from "../../expansion/expand";
import type { Env } from "../../system/env";

export const expandToolRoute = new Hono<{ Bindings: Env }>();

expandToolRoute.post("/", async (c) => {
  const authenticatedUserId = c.req.header("x-user-id") ?? c.req.header("X-User-ID");
  if (!authenticatedUserId) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<ExpandToolRequest>();
  if (body.userId !== authenticatedUserId) return c.json({ error: "forbidden" }, 403);

  return c.json(await expandTool(c.env, body));
});
