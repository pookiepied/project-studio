import type { Env } from "../env";
import type { Category, SourceType, DecayRate } from "./types";

export type { Category, SourceType, DecayRate };
export { CATEGORIES, SOURCE_TYPES, DECAY_RATES } from "./types";

interface FactRow {
  id: string;
  user_id: string;
  category: Category;
  content: string;
  auto_tags: string;
  importance: number;
  confidence: number;
  source_type: SourceType;
  decay_rate: DecayRate;
  last_accessed_at: string | null;
  access_count: number;
  source_conversation_id: string | null;
  embedding_id: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Fact {
  id: string;
  category: Category;
  content: string;
  autoTags: string[];
  importance: number;
  confidence: number;
  sourceType: SourceType;
  decayRate: DecayRate;
  lastAccessedAt: string | null;
  accessCount: number;
  sourceConversationId: string | null;
  embeddingId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function fromRow(r: FactRow): Fact {
  return {
    id:                   r.id,
    category:             r.category,
    content:              r.content,
    autoTags:             JSON.parse(r.auto_tags),
    importance:           r.importance,
    confidence:           r.confidence,
    sourceType:           r.source_type,
    decayRate:            r.decay_rate,
    lastAccessedAt:       r.last_accessed_at,
    accessCount:          r.access_count,
    sourceConversationId: r.source_conversation_id,
    embeddingId:          r.embedding_id,
    expiresAt:            r.expires_at,
    createdAt:            r.created_at,
    updatedAt:            r.updated_at,
  };
}

export async function insertFact(
  env: Env,
  data: {
    id: string;
    userId: string;
    category: Category;
    content: string;
    autoTags: string[];
    importance: number;
    confidence?: number;
    sourceType?: SourceType;
    decayRate?: DecayRate;
    sourceConversationId?: string;
    embeddingId?: string;
    expiresAt?: string;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await env.MEMORY_DB
    .prepare(`
      INSERT INTO memory_facts
        (id, user_id, category, content, auto_tags, importance, confidence,
         source_type, decay_rate, last_accessed_at, access_count,
         source_conversation_id, embedding_id, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?)
    `)
    .bind(
      data.id,
      data.userId,
      data.category,
      data.content,
      JSON.stringify(data.autoTags),
      data.importance,
      data.confidence ?? 1.0,
      data.sourceType ?? "inferred",
      data.decayRate  ?? "slow",
      data.sourceConversationId ?? null,
      data.embeddingId          ?? null,
      data.expiresAt            ?? null,
      now,
      now,
    )
    .run();
}

/**
 * Reinforces an existing fact when a near-duplicate is extracted from a new
 * conversation. Raises importance to the higher of the two values and counts
 * the re-encounter as an access, keeping the fact from fading.
 */
export async function reinforceFact(
  env: Env,
  factId: string,
  newImportance: number
): Promise<void> {
  const now = new Date().toISOString();
  await env.MEMORY_DB
    .prepare(`
      UPDATE memory_facts
      SET importance       = MAX(importance, ?),
          access_count     = access_count + 1,
          last_accessed_at = ?,
          updated_at       = ?
      WHERE id = ?
    `)
    .bind(newImportance, now, now, factId)
    .run();
}

/**
 * Records that a set of facts were surfaced to the AI (via injection or recall).
 * Increments access_count and updates last_accessed_at for decay-rate tracking.
 * Intended to run fire-and-forget — callers should not await the return value.
 */
export async function touchFacts(env: Env, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now          = new Date().toISOString();
  const placeholders = ids.map(() => "?").join(",");
  await env.MEMORY_DB
    .prepare(`
      UPDATE memory_facts
      SET last_accessed_at = ?,
          access_count     = access_count + 1
      WHERE id IN (${placeholders})
    `)
    .bind(now, ...ids)
    .run();
}

export async function getFactsByIds(env: Env, ids: string[]): Promise<Fact[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.MEMORY_DB
    .prepare(`SELECT * FROM memory_facts WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<FactRow>();
  return results.map(fromRow);
}

export async function listFacts(
  env: Env,
  userId: string,
  opts: { category?: Category; tag?: string; limit?: number; offset?: number }
): Promise<{ facts: Fact[]; total: number }> {
  const now    = new Date().toISOString();
  const limit  = opts.limit  ?? 20;
  const offset = opts.offset ?? 0;

  let where = "user_id = ? AND (expires_at IS NULL OR expires_at > ?)";
  const params: unknown[] = [userId, now];

  if (opts.category) { where += " AND category = ?";          params.push(opts.category); }
  if (opts.tag)      { where += " AND auto_tags LIKE ?";       params.push(`%"${opts.tag}"%`); }

  const countRow = await env.MEMORY_DB
    .prepare(`SELECT COUNT(*) as count FROM memory_facts WHERE ${where}`)
    .bind(...params)
    .first<{ count: number }>();

  const { results } = await env.MEMORY_DB
    .prepare(`
      SELECT * FROM memory_facts
      WHERE ${where}
      ORDER BY importance DESC, access_count DESC, updated_at DESC
      LIMIT ? OFFSET ?
    `)
    .bind(...params, limit, offset)
    .all<FactRow>();

  return { facts: results.map(fromRow), total: countRow?.count ?? 0 };
}

export async function deleteFact(env: Env, userId: string, id: string): Promise<boolean> {
  const result = await env.MEMORY_DB
    .prepare("DELETE FROM memory_facts WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function bulkDeleteFacts(
  env: Env,
  userId: string,
  opts: { tag?: string; category?: Category; beforeDate?: string }
): Promise<number> {
  let where = "user_id = ?";
  const params: unknown[] = [userId];

  if (opts.category)   { where += " AND category = ?";     params.push(opts.category); }
  if (opts.tag)        { where += " AND auto_tags LIKE ?"; params.push(`%"${opts.tag}"%`); }
  if (opts.beforeDate) { where += " AND created_at < ?";   params.push(opts.beforeDate); }

  const result = await env.MEMORY_DB
    .prepare(`DELETE FROM memory_facts WHERE ${where}`)
    .bind(...params)
    .run();
  return result.meta.changes ?? 0;
}

export async function countFactsByCategory(
  env: Env,
  userId: string
): Promise<Record<Category, number>> {
  const { results } = await env.MEMORY_DB
    .prepare(`
      SELECT category, COUNT(*) as count
      FROM memory_facts
      WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)
      GROUP BY category
    `)
    .bind(userId, new Date().toISOString())
    .all<{ category: Category; count: number }>();

  const counts: Record<Category, number> = {
    identity: 0, preference: 0, project: 0, event: 0, knowledge: 0,
  };
  for (const r of results) counts[r.category] = r.count;
  return counts;
}
