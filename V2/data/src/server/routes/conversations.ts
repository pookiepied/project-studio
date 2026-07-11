import { Hono } from "hono";
import type { Env } from "../../system/env";

export const conversationsRoute = new Hono<{ Bindings: Env }>();

conversationsRoute.get("/", async (c) => {
  const userId = requireUserId(c.req.raw);
  const rows = await c.env.DATA_DB.prepare(
    `SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
     FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`,
  )
    .bind(userId)
    .all();
  return c.json({ conversations: rows.results ?? [] });
});

conversationsRoute.post("/", async (c) => {
  const userId = requireUserId(c.req.raw);
  const body: { id?: string; title?: string } = await c.req
    .json<{ id?: string; title?: string }>()
    .catch(() => ({}));
  const id = body.id ?? `conv_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await c.env.DATA_DB.prepare(
    `INSERT INTO conversations (id, user_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       title = COALESCE(excluded.title, conversations.title),
       updated_at = excluded.updated_at
     WHERE conversations.user_id = excluded.user_id`,
  )
    .bind(id, userId, body.title ?? null, now, now)
    .run();
  return c.json({ id, title: body.title ?? null, createdAt: now, updatedAt: now });
});

conversationsRoute.get("/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  const row = await c.env.DATA_DB.prepare(
    `SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
     FROM conversations WHERE id = ? AND user_id = ?`,
  )
    .bind(c.req.param("id"), userId)
    .first();
  return row ? c.json(row) : c.json({ error: "not_found" }, 404);
});

conversationsRoute.get("/:id/messages", async (c) => {
  const userId = requireUserId(c.req.raw);
  const allowed = await ownsConversation(c.env, userId, c.req.param("id"));
  if (!allowed) return c.json({ error: "not_found" }, 404);

  const rows = await c.env.DATA_DB.prepare(
    `SELECT id, role, content, created_at AS createdAt
     FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC`,
  )
    .bind(c.req.param("id"), userId)
    .all();
  return c.json({ messages: rows.results ?? [] });
});

conversationsRoute.post("/:id/messages", async (c) => {
  const userId = requireUserId(c.req.raw);
  const conversationId = c.req.param("id");
  const allowed = await ownsConversation(c.env, userId, conversationId);
  if (!allowed) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<{
    id?: string;
    role: "user" | "assistant" | "system";
    content: string;
  }>();
  const id = body.id ?? `msg_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await c.env.DATA_DB.prepare(
    `INSERT INTO messages (id, conversation_id, user_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET content = excluded.content`,
  )
    .bind(id, conversationId, userId, body.role, body.content, now)
    .run();
  await c.env.DATA_DB.prepare("UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(now, conversationId, userId)
    .run();
  return c.json({ id, conversationId, role: body.role, content: body.content, createdAt: now });
});

conversationsRoute.delete("/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  await c.env.DATA_DB.prepare("DELETE FROM messages WHERE conversation_id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  const result = await c.env.DATA_DB.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ deleted: result.meta.changes > 0 });
});

async function ownsConversation(env: Env, userId: string, conversationId: string): Promise<boolean> {
  const row = await env.DATA_DB.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
    .bind(conversationId, userId)
    .first();
  return Boolean(row);
}

function requireUserId(request: Request): string {
  const userId = request.headers.get("X-User-ID") ?? request.headers.get("x-user-id");
  if (!userId) throw new Error("X-User-ID required");
  return userId;
}
