import { Hono } from "hono";
import type { Env } from "../../system/env";

/** Skill registrations (ARCHITECTURE.md §12). Instructions load progressively. */
export const skillsRoute = new Hono<{ Bindings: Env }>();

skillsRoute.get("/", (c) => c.json({ error: "not_implemented" }, 501));
skillsRoute.post("/", (c) => c.json({ error: "not_implemented" }, 501));
skillsRoute.get("/:id", (c) => c.json({ error: "not_implemented" }, 501));
skillsRoute.patch("/:id", (c) => c.json({ error: "not_implemented" }, 501));
skillsRoute.delete("/:id", (c) => c.json({ error: "not_implemented" }, 501));
