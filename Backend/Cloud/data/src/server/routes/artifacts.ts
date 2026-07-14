import { Hono } from "hono";
import type { Env } from "../../system/env";
import { deleteObject, getObject, objectKey, putObject } from "../../storage/objects";

export const artifactsRoute = new Hono<{ Bindings: Env }>();

artifactsRoute.get("/", async (c) => {
  const userId = requireUserId(c.req.raw);
  const rows = await c.env.DATA_DB.prepare(
    `SELECT id, conversation_id AS conversationId, kind, name, content_type AS contentType,
      version, created_at AS createdAt
     FROM artifacts WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(userId)
    .all();
  return c.json({ artifacts: rows.results ?? [] });
});

artifactsRoute.post("/", async (c) => {
  const userId = requireUserId(c.req.raw);
  const id = `art_${crypto.randomUUID()}`;
  const name = c.req.header("X-Artifact-Name") ?? id;
  const kind = c.req.header("X-Artifact-Kind") ?? "file";
  const conversationId = c.req.header("X-Conversation-ID");
  const contentType = c.req.header("Content-Type") ?? "application/octet-stream";
  const body = await c.req.raw.arrayBuffer();
  const key = objectKey(userId, "generated", id);

  await putObject(c.env, "generated", key, body, contentType);
  await c.env.DATA_DB.prepare(
    `INSERT INTO artifacts (id, user_id, conversation_id, kind, name, content_type, storage_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, conversationId, kind, name, contentType, key)
    .run();

  return c.json({ id, conversationId, kind, name, contentType });
});

artifactsRoute.get("/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  const record = await c.env.DATA_DB.prepare(
    "SELECT storage_key, content_type, name FROM artifacts WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), userId)
    .first<{ storage_key: string; content_type: string; name: string }>();
  if (!record) return c.json({ error: "not_found" }, 404);

  const object = await getObject(c.env, "generated", record.storage_key);
  if (!object) return c.json({ error: "not_found" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": record.content_type,
      "Content-Disposition": `inline; filename="${record.name.replace(/"/g, "")}"`,
    },
  });
});

artifactsRoute.delete("/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  const record = await c.env.DATA_DB.prepare(
    "SELECT storage_key FROM artifacts WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), userId)
    .first<{ storage_key: string }>();
  if (!record) return c.json({ error: "not_found" }, 404);

  await deleteObject(c.env, "generated", record.storage_key);
  await c.env.DATA_DB.prepare("DELETE FROM artifacts WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ deleted: true });
});

function requireUserId(request: Request): string {
  const userId = request.headers.get("X-User-ID") ?? request.headers.get("x-user-id");
  if (!userId) throw new Error("X-User-ID required");
  return userId;
}
