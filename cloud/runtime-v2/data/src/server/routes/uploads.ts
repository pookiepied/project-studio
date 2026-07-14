import { Hono } from "hono";
import type { Env } from "../../system/env";
import { deleteObject, getObject, objectKey, putObject } from "../../storage/objects";

export const uploadsRoute = new Hono<{ Bindings: Env }>();

uploadsRoute.post("/", async (c) => {
  const userId = requireUserId(c.req.raw);
  const id = `upl_${crypto.randomUUID()}`;
  const name = c.req.header("X-File-Name") ?? id;
  const conversationId = c.req.header("X-Conversation-ID");
  const contentType = c.req.header("Content-Type") ?? "application/octet-stream";
  const body = await c.req.raw.arrayBuffer();
  const key = objectKey(userId, "uploads", id);

  await putObject(c.env, "uploads", key, body, contentType);
  await c.env.DATA_DB.prepare(
    `INSERT INTO attachments (id, user_id, conversation_id, name, content_type,
      size_bytes, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, conversationId, name, contentType, body.byteLength, key)
    .run();

  return c.json({ id, name, conversationId, contentType, sizeBytes: body.byteLength });
});

uploadsRoute.get("/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  const record = await c.env.DATA_DB.prepare(
    "SELECT storage_key, content_type, name FROM attachments WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), userId)
    .first<{ storage_key: string; content_type: string; name: string }>();
  if (!record) return c.json({ error: "not_found" }, 404);

  const object = await getObject(c.env, "uploads", record.storage_key);
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
    "SELECT storage_key FROM attachments WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), userId)
    .first<{ storage_key: string }>();
  if (!record) return c.json({ error: "not_found" }, 404);

  await deleteObject(c.env, "uploads", record.storage_key);
  await c.env.DATA_DB.prepare("DELETE FROM attachments WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ deleted: true });
});

function requireUserId(request: Request): string {
  const userId = request.headers.get("X-User-ID") ?? request.headers.get("x-user-id");
  if (!userId) throw new Error("X-User-ID required");
  return userId;
}
