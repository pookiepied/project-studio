import { createMiddleware } from "hono/factory";
import type { GatewayApp } from "../types";

export const requestIdMiddleware = createMiddleware<GatewayApp>(async (c, next) => {
  const requestId = c.req.header("x-request-id") || crypto.randomUUID();
  c.set("requestId", requestId);
  await next();
  c.header("x-request-id", requestId);
});
