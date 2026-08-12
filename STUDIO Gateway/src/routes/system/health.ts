/**
 * System route: health
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";

export const healthRoute = new Hono<{ Bindings: Env }>();

healthRoute.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT ?? "unknown",
  });
});

healthRoute.get("/ready", async (c) => {
  // Check D1 connectivity
  try {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({ status: "ready", db: "ok" });
  } catch (e) {
    return c.json({ status: "error", db: String(e) }, 500);
  }
});
