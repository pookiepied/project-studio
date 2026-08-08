import { Hono } from "hono";
import type { GatewayEnv } from "@/platform/cloudflare/environment";
import { getLiveness, getProviderHealth, getReadiness } from "./status";

export const healthRoute = new Hono<{ Bindings: GatewayEnv }>();

healthRoute.get("/", (c) => c.json(getLiveness(c.env)));
healthRoute.get("/ready", (c) => {
  const readiness = getReadiness(c.env);
  return c.json(readiness.body, readiness.ready ? 200 : 503);
});
healthRoute.get("/providers", (c) => c.json(getProviderHealth(c.env)));
