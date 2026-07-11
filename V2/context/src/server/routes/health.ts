import { Hono } from "hono";
import type { Env } from "../../system/env";

export const healthRoute = new Hono<{ Bindings: Env }>();

healthRoute.get("/", (c) => c.json({ service: "studio-context", status: "ok" }));
