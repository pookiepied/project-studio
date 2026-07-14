import { Hono } from "hono";
import type { Env } from "./system/env";
import { listSystemSkillDefinitions, readSystemSkillContent } from "./domains/skills/systemSkills";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) =>
  c.json({
    service: "studio-cloud-skill-library",
    status: "ok",
    environment: c.env.ENVIRONMENT,
  }),
);

app.get("/skills/system", (c) => c.json({ items: listSystemSkillDefinitions() }));

app.get("/skills/system/:id/read", (c) => {
  const skill = listSystemSkillDefinitions().find((item) => item.id === c.req.param("id") || item.slug === c.req.param("id"));
  if (!skill) return c.json({ error: "not_found" }, 404);
  const content = readSystemSkillContent(skill.id);
  if (!content) return c.json({ error: "content_not_found" }, 404);
  return c.json({ skill, content, frontmatter: { name: skill.name, description: skill.description }, resourceRefs: skill.resources });
});

export default app;
