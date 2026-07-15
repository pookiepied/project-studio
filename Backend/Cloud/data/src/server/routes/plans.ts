import { Hono } from "hono";
import type { Plan } from "../../contracts";
import type { Env } from "../../system/env";
import { requireOwnedConversation, requireUserId } from "../identity";

export const plansRoute = new Hono<{ Bindings: Env }>();

plansRoute.post("/", async (c) => {
  const userId = requireUserId(c.req.raw);
  const body = await c.req.json<Plan & { conversationId?: string }>();
  if (body.userId !== userId) return c.json({ error: "forbidden" }, 403);
  const conversationId = await requireOwnedConversation(c.env, userId, body.conversationId);
  const createdAt = body.createdAt ?? new Date().toISOString();
  await c.env.DATA_DB.prepare(
    `INSERT INTO plans(id,user_id,conversation_id,goal,body,created_at)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(id,user_id) DO UPDATE SET
       conversation_id=excluded.conversation_id,
       goal=excluded.goal,
       body=excluded.body`,
  ).bind(body.planId, userId, conversationId, body.goal, JSON.stringify({ ...body, conversationId, createdAt }), createdAt).run();
  return c.json({ plan: { ...body, conversationId, createdAt } }, 201);
});

plansRoute.get("/", async (c) => {
  const userId = requireUserId(c.req.raw);
  const conversationId = await requireOwnedConversation(c.env, userId, c.req.query("conversationId"));
  const query = conversationId
    ? c.env.DATA_DB.prepare("SELECT body FROM plans WHERE user_id=? AND conversation_id=? ORDER BY created_at DESC").bind(userId, conversationId)
    : c.env.DATA_DB.prepare("SELECT body FROM plans WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(userId);
  const rows = await query.all<{ body: string }>();
  return c.json({ plans: (rows.results ?? []).map((row) => JSON.parse(row.body)) });
});

plansRoute.get("/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  const row = await c.env.DATA_DB.prepare("SELECT body FROM plans WHERE user_id=? AND id=?")
    .bind(userId, c.req.param("id"))
    .first<{ body: string }>();
  return row ? c.json({ plan: JSON.parse(row.body) }) : c.json({ error: "not_found" }, 404);
});
