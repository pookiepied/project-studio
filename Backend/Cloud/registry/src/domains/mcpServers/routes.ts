import { Hono } from "hono";
import { notFound } from "../../errors/appError";
import { requireIdentity, requireRegistryWriter } from "../../system/identity";
import type { AppBindings } from "../../system/app";
import { listSystemMcpServerRegistrations } from "./library/systemServers";
import { deleteMcpServer, getMcpServer, listMcpServers, saveMcpServer } from "./repository";
import { mcpChangeNote, normalizeMcpServerCreate, normalizeMcpServerPatch, parseMcpServerSearch } from "./validation";

export const mcpServersRoute = new Hono<AppBindings>();

mcpServersRoute.get("/", async (c) => {
  const { userId } = requireIdentity(c);
  const search = parseMcpServerSearch(new URL(c.req.url), userId);
  return c.json({ items: await listMcpServers(c.env.REGISTRY_DB, search) });
});

mcpServersRoute.post("/", async (c) => {
  requireIdentity(c);
  requireRegistryWriter(c);
  const body = await c.req.json();
  const saved = await saveMcpServer(c.env.REGISTRY_DB, normalizeMcpServerCreate(body), mcpChangeNote(body));
  return c.json(saved, 201);
});

mcpServersRoute.post("/register-system", async (c) => {
  requireIdentity(c);
  requireRegistryWriter(c);
  const saved = [];
  for (const server of listSystemMcpServerRegistrations()) {
    saved.push(await saveMcpServer(c.env.REGISTRY_DB, server, "Registered bundled system MCP server."));
  }
  return c.json({ registered: saved.length, items: saved });
});

mcpServersRoute.get("/system-definitions", (c) => {
  requireIdentity(c);
  return c.json({ items: listSystemMcpServerRegistrations() });
});

mcpServersRoute.get("/:id", async (c) => {
  const { userId } = requireIdentity(c);
  const server = await getMcpServer(c.env.REGISTRY_DB, userId, c.req.param("id"));
  if (!server) throw notFound("MCP server not found.");
  return c.json(server);
});

mcpServersRoute.patch("/:id", async (c) => {
  const { userId } = requireIdentity(c);
  requireRegistryWriter(c);
  const current = await getMcpServer(c.env.REGISTRY_DB, userId, c.req.param("id"));
  if (!current) throw notFound("MCP server not found.");
  const body = await c.req.json();
  const saved = await saveMcpServer(c.env.REGISTRY_DB, normalizeMcpServerPatch(current, body), mcpChangeNote(body));
  return c.json(saved);
});

mcpServersRoute.delete("/:id", async (c) => {
  const { userId } = requireIdentity(c);
  requireRegistryWriter(c);
  return c.json({ deleted: await deleteMcpServer(c.env.REGISTRY_DB, userId, c.req.param("id")) });
});
