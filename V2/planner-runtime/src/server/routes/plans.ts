import { Hono } from "hono";
import type { Env } from "../../system/env";

/** Plan lifecycle: create a planning session, fetch the resulting Plan. */
export const plansRoute = new Hono<{ Bindings: Env }>();

plansRoute.post("/", (c) => c.json({ error: "not_implemented" }, 501));
plansRoute.get("/:planId", (c) => c.json({ error: "not_implemented" }, 501));
