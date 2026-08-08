import { Hono } from "hono";
import type { Env } from "../../system/env";
import { deleteManagedObject, getManagedObject, putManagedObject } from "../../storage/objects";
import { requireOwnedConversation, requireUserId } from "../identity";

export const uploadsRoute = new Hono<{ Bindings: Env }>();

uploadsRoute.post("/", async (c) => {
  const userId = requireUserId(c.req.raw);
  const id = `upl_${crypto.randomUUID()}`;
  const name = c.req.header("X-File-Name") ?? id;
  const conversationId = await requireOwnedConversation(c.env, userId, c.req.header("X-Conversation-ID"));
  const contentType = c.req.header("Content-Type") ?? "application/octet-stream";
  const body = await c.req.raw.arrayBuffer();
  const object = await putManagedObject(c.env, {
    userId,
    conversationId,
    bucket: "uploads",
    resourceType: "upload",
    resourceId: id,
    contentType,
    body,
    compress: false,
    metadata: { name },
  });

  await c.env.DATA_DB.prepare(
    `INSERT INTO attachments (id, user_id, conversation_id, object_id, name, content_type,
      size_bytes, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, conversationId, object.id, name, contentType, body.byteLength, object.storageKey)
    .run();

  return c.json({ id, objectId: object.id, name, conversationId, contentType, sizeBytes: body.byteLength });
});

uploadsRoute.get("/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  const record = await c.env.DATA_DB.prepare(
    "SELECT object_id AS objectId, storage_key, content_type, name FROM attachments WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), userId)
    .first<{ objectId: string | null; storage_key: string; content_type: string; name: string }>();
  if (!record) return c.json({ error: "not_found" }, 404);

  const object = record.objectId ? await getManagedObject(c.env, userId, record.objectId) : null;
  if (!object) return c.json({ error: "not_found" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": record.content_type,
      "Content-Disposition": `inline; filename="${record.name.replace(/"/g, "")}"`,
    },
  });
});

uploadsRoute.delete("/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  const record = await c.env.DATA_DB.prepare(
    "SELECT object_id AS objectId FROM attachments WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), userId)
    .first<{ objectId: string | null }>();
  if (!record) return c.json({ error: "not_found" }, 404);

  if (record.objectId) await deleteManagedObject(c.env, userId, record.objectId);
  await c.env.DATA_DB.prepare("DELETE FROM attachments WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ deleted: true });
});
