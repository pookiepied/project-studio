import { Hono } from "hono";
import { notFound } from "../../errors/appError";
import { requireIdentity, requireRegistryWriter } from "../../system/identity";
import type { AppBindings } from "../../system/app";
import { listSystemAgentDefinitions } from "./library/systemAgents";
import { toSystemAgentRegistration } from "./library/registration";
import { deleteAgent, getAgent, listAgents, saveAgentRegistration } from "./repository";
import { normalizeAgentRegistrationCreate, normalizeAgentRegistrationPatch, parseAgentSearch } from "./validation";

export const agentsRoute = new Hono<AppBindings>();

agentsRoute.get("/", async (c) => {
  const { userId } = requireIdentity(c);
  return c.json({ items: await listAgents(c.env.REGISTRY_DB, parseAgentSearch(new URL(c.req.url), userId)) });
});

agentsRoute.post("/register-system", async (c) => {
  requireIdentity(c);
  requireRegistryWriter(c);
  const saved = [];
  for (const definition of listSystemAgentDefinitions()) {
    saved.push(await saveAgentRegistration(c.env.REGISTRY_DB, toSystemAgentRegistration(definition)));
  }
  return c.json({ registered: saved.length, items: saved });
});

agentsRoute.get("/system-definitions", async (c) => {
  requireIdentity(c);
  return c.json({ items: listSystemAgentDefinitions() });
});

agentsRoute.get("/:id", async (c) => {
  const { userId } = requireIdentity(c);
  const agent = await getAgent(c.env.REGISTRY_DB, userId, c.req.param("id"));
  if (!agent) throw notFound("Agent registration not found.");
  return c.json(agent);
});

agentsRoute.post("/", async (c) => {
  requireIdentity(c);
  requireRegistryWriter(c);
  const saved = await saveAgentRegistration(c.env.REGISTRY_DB, normalizeAgentRegistrationCreate(await c.req.json()));
  return c.json(saved, 201);
});

agentsRoute.patch("/:id", async (c) => {
  const { userId } = requireIdentity(c);
  requireRegistryWriter(c);
  const current = await getAgent(c.env.REGISTRY_DB, userId, c.req.param("id"));
  if (!current) throw notFound("Agent registration not found.");
  return c.json(await saveAgentRegistration(c.env.REGISTRY_DB, normalizeAgentRegistrationPatch(current, await c.req.json())));
});

agentsRoute.delete("/:id", async (c) => {
  const { userId } = requireIdentity(c);
  requireRegistryWriter(c);
  return c.json({ deleted: await deleteAgent(c.env.REGISTRY_DB, userId, c.req.param("id")) });
});
