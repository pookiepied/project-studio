import { Hono } from "hono";
import type { Env } from "../../system/env";

/**
 * Agent definitions (ARCHITECTURE.md §13): user-created and Studio-provided
 * agents as versioned records. The registry stores definitions; the Agent
 * Runtime executes them.
 */
export const agentsRoute = new Hono<{ Bindings: Env }>();

agentsRoute.get("/", (c) => c.json({ error: "not_implemented" }, 501));
agentsRoute.post("/", (c) => c.json({ error: "not_implemented" }, 501));
agentsRoute.get("/:id", (c) => c.json({ error: "not_implemented" }, 501));
agentsRoute.patch("/:id", (c) => c.json({ error: "not_implemented" }, 501));
agentsRoute.delete("/:id", (c) => c.json({ error: "not_implemented" }, 501));
