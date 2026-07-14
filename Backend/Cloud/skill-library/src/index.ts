import { Hono } from "hono";
import type { Env } from "./system/env";
import { listSystemSkillDefinitions } from "./domains/skills/systemSkills";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) =>
  c.json({
    service: "studio-cloud-skill-library",
    status: "ok",
    environment: c.env.ENVIRONMENT,
  }),
);

app.get("/skills/system", (c) => c.json({ items: listSystemSkillDefinitions() }));

export default app;
