import { Hono } from "hono";
import type { Env } from "../../system/env";

export const healthRoute = new Hono<{ Bindings: Env }>();

healthRoute.get("/", async (c) => {
  let database: "ok" | "error" = "ok";
  try {
    await c.env.TOOL_EXECUTION_DB.prepare("SELECT 1").first();
  } catch {
    database = "error";
  }
  return c.json({
    service: "studio-tool-execution",
    status: database === "ok" ? "ok" : "degraded",
    environment: c.env.ENVIRONMENT,
    dependencies: { database },
  }, database === "ok" ? 200 : 503);
});
