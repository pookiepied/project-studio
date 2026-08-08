import { Hono } from "hono";
import type { Env } from "../../system/env";
import { getManagedObject, readObjectRecord } from "../../storage/objects";
import { requireUserId } from "../identity";

export const objectsRoute = new Hono<{ Bindings: Env }>();

objectsRoute.get("/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  const object = await getManagedObject(c.env, userId, c.req.param("id"));
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.record.contentType,
      "X-Studio-Object-ID": object.record.id,
      "X-Studio-Compression": object.record.compression,
    },
  });
});

objectsRoute.get("/:id/metadata", async (c) => {
  const userId = requireUserId(c.req.raw);
  const record = await readObjectRecord(c.env, userId, c.req.param("id"));
  return record ? c.json(record) : c.json({ error: "not_found" }, 404);
});

