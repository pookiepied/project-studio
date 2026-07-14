import { Hono } from "hono";
import { notFound } from "../../errors/appError";
import { requireIdentity, requireRegistryWriter } from "../../system/identity";
import type { AppBindings } from "../../system/app";
import { deleteSkill, getSkill, listSkills, saveSkill } from "./repository";
import { listSystemSkillRegistrations } from "./library/systemSkills";
import { normalizeSkillCreate, normalizeSkillPatch, parseSkillSearch, skillChangeNote } from "./validation";

export const skillsRoute = new Hono<AppBindings>();

skillsRoute.get("/", async (c) => {
  const { userId } = requireIdentity(c);
  const search = parseSkillSearch(new URL(c.req.url), userId);
  return c.json({ items: await listSkills(c.env.REGISTRY_DB, search) });
});

skillsRoute.post("/", async (c) => {
  requireIdentity(c);
  requireRegistryWriter(c);
  const body = await c.req.json();
  const saved = await saveSkill(c.env.REGISTRY_DB, normalizeSkillCreate(body), skillChangeNote(body));
  return c.json(saved, 201);
});

skillsRoute.post("/register-system", async (c) => {
  requireIdentity(c);
  requireRegistryWriter(c);
  const saved = [];
  for (const skill of listSystemSkillRegistrations()) {
    saved.push(await saveSkill(c.env.REGISTRY_DB, skill, "Registered bundled system skill."));
  }
  return c.json({ registered: saved.length, items: saved });
});

skillsRoute.get("/system-definitions", (c) => {
  requireIdentity(c);
  return c.json({ items: listSystemSkillRegistrations() });
});

skillsRoute.get("/:id", async (c) => {
  const { userId } = requireIdentity(c);
  const skill = await getSkill(c.env.REGISTRY_DB, userId, c.req.param("id"));
  if (!skill) throw notFound("Skill not found.");
  return c.json(skill);
});

skillsRoute.patch("/:id", async (c) => {
  const { userId } = requireIdentity(c);
  requireRegistryWriter(c);
  const current = await getSkill(c.env.REGISTRY_DB, userId, c.req.param("id"));
  if (!current) throw notFound("Skill not found.");
  const body = await c.req.json();
  const saved = await saveSkill(c.env.REGISTRY_DB, normalizeSkillPatch(current, body), skillChangeNote(body));
  return c.json(saved);
});

skillsRoute.delete("/:id", async (c) => {
  const { userId } = requireIdentity(c);
  requireRegistryWriter(c);
  return c.json({ deleted: await deleteSkill(c.env.REGISTRY_DB, userId, c.req.param("id")) });
});
