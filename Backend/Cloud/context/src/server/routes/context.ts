import { Hono } from "hono";
import type { Env } from "../../system/env";
import { assembleContext, type ContextRequest } from "../../assembly/assemble";

/** Builds a ContextPackage for a (user, task) pair on request from a runtime. */
export const contextRoute = new Hono<{ Bindings: Env }>();

contextRoute.post("/", async (c) => {
  const authenticatedUserId = c.req.header("x-user-id") ?? c.req.header("X-User-ID");
  if (!authenticatedUserId) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<ContextRequest>();
  if (body.userId !== authenticatedUserId) {
    return c.json({ error: "forbidden" }, 403);
  }

  return c.json(await assembleContext(c.env, body));
});
