import { Hono } from "hono";
import type { Env } from "../../system/env";

/**
 * Invoke a registered agent — directly by a user, on a schedule, or as a
 * delegation from a parent runtime (DelegationRequest in contracts).
 */
export const invokeRoute = new Hono<{ Bindings: Env }>();

invokeRoute.post("/:agentId", (c) => c.json({ error: "not_implemented" }, 501));
