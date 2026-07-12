import { Hono } from "hono";
import type { RegistrySkillRecord } from "@studio/v2-contracts";
import type { Env } from "../../system/env";
import { deleteSkill, getSkill, listSkills, upsertSkill } from "../../domains/skills/repository";
import { requireUser } from "../identity";

export const skillsRoute = new Hono<{ Bindings: Env }>();

skillsRoute.get("/", async (c) => {
  const userId = requireUser(c);
  return typeof userId === "string" ? c.json({ items: await listSkills(c.env.REGISTRY_DB, userId) }) : userId;
});

skillsRoute.post("/", async (c) => {
  const userId = requireUser(c);
  if (typeof userId !== "string") return userId;
  const record = await c.req.json<RegistrySkillRecord>();
  if (record.userId !== userId || record.ref.kind !== "skill") return c.json({ error: "forbidden" }, 403);
  await upsertSkill(c.env.REGISTRY_DB, record);
  return c.json(record, 201);
});

skillsRoute.get("/:id", async (c) => {
  const userId = requireUser(c);
  if (typeof userId !== "string") return userId;
  const record = await getSkill(c.env.REGISTRY_DB, userId, c.req.param("id"));
  return record ? c.json(record) : c.json({ error: "not_found" }, 404);
});

skillsRoute.patch("/:id", async (c) => {
  const userId = requireUser(c);
  if (typeof userId !== "string") return userId;
  const current = await getSkill(c.env.REGISTRY_DB, userId, c.req.param("id"));
  if (!current) return c.json({ error: "not_found" }, 404);
  const patch = await c.req.json<Partial<RegistrySkillRecord>>();
  const next = { ...current, ...patch, ref: current.ref, userId };
  await upsertSkill(c.env.REGISTRY_DB, next);
  return c.json(next);
});

for (const property of ["available", "enabled"] as const) {
  skillsRoute.post(`/:id/${property}`, async (c) => {
    const userId = requireUser(c);
    if (typeof userId !== "string") return userId;
    const current = await getSkill(c.env.REGISTRY_DB, userId, c.req.param("id"));
    if (!current) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<Record<typeof property, boolean>>();
    const next = { ...current, [property]: Boolean(body[property]) };
    await upsertSkill(c.env.REGISTRY_DB, next);
    return c.json({ [property]: next[property] });
  });
}

skillsRoute.delete("/:id", async (c) => {
  const userId = requireUser(c);
  if (typeof userId !== "string") return userId;
  return c.json({ deleted: await deleteSkill(c.env.REGISTRY_DB, userId, c.req.param("id")) });
});
