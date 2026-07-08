import type { Env } from "../env";

interface ConversationRow {
  id: string;
  user_id: string;
  summary: string;
  key_points: string;
  topics: string;
  participants: string | null;
  importance: number;
  message_count: number;
  embedding_id: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  summary: string;
  keyPoints: string[];
  topics: string[];
  participants: string[];
  importance: number;
  messageCount: number;
  embeddingId: string | null;
  createdAt: string;
}

function fromRow(r: ConversationRow): Conversation {
  return {
    id:          r.id,
    summary:     r.summary,
    keyPoints:   JSON.parse(r.key_points),
    topics:      JSON.parse(r.topics),
    participants: r.participants ? JSON.parse(r.participants) : [],
    importance:  r.importance,
    messageCount: r.message_count,
    embeddingId: r.embedding_id,
    createdAt:   r.created_at,
  };
}

export async function insertConversation(
  env: Env,
  data: {
    id: string;
    userId: string;
    summary: string;
    keyPoints: string[];
    topics: string[];
    participants: string[];
    importance: number;
    messageCount: number;
    embeddingId?: string;
  }
): Promise<void> {
  await env.MEMORY_DB
    .prepare(`
      INSERT INTO memory_conversations
        (id, user_id, summary, key_points, topics, participants,
         importance, message_count, embedding_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      data.id,
      data.userId,
      data.summary,
      JSON.stringify(data.keyPoints),
      JSON.stringify(data.topics),
      JSON.stringify(data.participants),
      data.importance,
      data.messageCount,
      data.embeddingId ?? null,
      new Date().toISOString(),
    )
    .run();
}

export async function getRecentConversations(
  env: Env,
  userId: string,
  limit: number
): Promise<Conversation[]> {
  const { results } = await env.MEMORY_DB
    .prepare(`
      SELECT * FROM memory_conversations
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .bind(userId, limit)
    .all<ConversationRow>();
  return results.map(fromRow);
}

export async function getConversationsByIds(env: Env, ids: string[]): Promise<Conversation[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.MEMORY_DB
    .prepare(`SELECT * FROM memory_conversations WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<ConversationRow>();
  return results.map(fromRow);
}

export async function deleteConversation(env: Env, userId: string, id: string): Promise<boolean> {
  const result = await env.MEMORY_DB
    .prepare("DELETE FROM memory_conversations WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function countConversations(env: Env, userId: string): Promise<number> {
  const row = await env.MEMORY_DB
    .prepare("SELECT COUNT(*) as count FROM memory_conversations WHERE user_id = ?")
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
