import { Hono } from "hono";
import type { ToolDiscoveryRequest, ToolPoolScope, ToolResolveRequest } from "../contracts";
import { buildProjection, discoverTools, resolveTools } from "../inventory/build";
import type { Env } from "../system/env";
import { assertScopeUser, requireUserId } from "./auth";

export const routes = new Hono<{ Bindings: Env }>();

routes.get("/health", (c) => c.json({ ok: true, service: "studio-tool-pool", environment: c.env.ENVIRONMENT }));

routes.post("/projection", async (c) => {
  const body = await c.req.json<ToolPoolScope>();
  assertScopeUser(c.req.raw, body);
  return c.json(await buildProjection(c.env, body));
});

routes.post("/discover", async (c) => {
  const body = await c.req.json<ToolDiscoveryRequest>();
  assertScopeUser(c.req.raw, body);
  return c.json(await discoverTools(c.env, body));
});

routes.post("/resolve", async (c) => {
  const body = await c.req.json<ToolResolveRequest>();
  assertScopeUser(c.req.raw, body);
  return c.json(await resolveTools(c.env, body));
});

routes.post("/expand", async (c) => {
  const body = await c.req.json<ToolDiscoveryRequest>();
  assertScopeUser(c.req.raw, body);
  return c.json(await discoverTools(c.env, body));
});

routes.get("/defaults", async (c) => {
  const userId = requireUserId(c.req.raw);
  return c.json(await buildProjection(c.env, { userId, consumer: "execution" }));
});

