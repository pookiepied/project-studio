import { Hono } from "hono";
import type { Env } from "../../system/env";

export const healthRoute = new Hono<{ Bindings: Env }>();

healthRoute.get("/", async (c) => {
  const checks = {
    d1: "unknown",
    conversationsBucket: Boolean(c.env.CONVERSATIONS),
    uploadsBucket: Boolean(c.env.UPLOADS),
    generatedBucket: Boolean(c.env.GENERATED),
  };
  try {
    await c.env.DATA_DB.prepare("SELECT 1").first();
    checks.d1 = "ok";
  } catch {
    checks.d1 = "error";
  }
  const ok = checks.d1 === "ok" && checks.conversationsBucket && checks.uploadsBucket && checks.generatedBucket;
  return c.json({ service: "studio-data", status: ok ? "ok" : "degraded", checks }, ok ? 200 : 503);
});
