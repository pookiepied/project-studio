import type { Env } from "../env";

interface RelationRow {
  id: string;
  user_id: string;
  entity_a: string;
  relation: string;
  entity_b: string;
  strength: number;
  last_seen: string;
  source_conversation_ids: string;
}

export interface Relation {
  id: string;
  entityA: string;
  relation: string;
  entityB: string;
  strength: number;
  lastSeen: string;
}

function fromRow(r: RelationRow): Relation {
  return {
    id:       r.id,
    entityA:  r.entity_a,
    relation: r.relation,
    entityB:  r.entity_b,
    strength: r.strength,
    lastSeen: r.last_seen,
  };
}

export async function upsertRelation(
  env: Env,
  data: {
    userId: string;
    entityA: string;
    relation: string;
    entityB: string;
    conversationId: string;
  }
): Promise<void> {
  const now = new Date().toISOString();

  const existing = await env.MEMORY_DB
    .prepare(`
      SELECT id, strength, source_conversation_ids
      FROM memory_relations
      WHERE user_id = ? AND entity_a = ? AND relation = ? AND entity_b = ?
    `)
    .bind(data.userId, data.entityA, data.relation, data.entityB)
    .first<{ id: string; strength: number; source_conversation_ids: string }>();

  if (existing) {
    const sources: string[] = JSON.parse(existing.source_conversation_ids);
    if (!sources.includes(data.conversationId)) sources.push(data.conversationId);
    await env.MEMORY_DB
      .prepare(`
        UPDATE memory_relations
        SET strength = ?, last_seen = ?, source_conversation_ids = ?
        WHERE id = ?
      `)
      .bind(existing.strength + 1, now, JSON.stringify(sources), existing.id)
      .run();
  } else {
    await env.MEMORY_DB
      .prepare(`
        INSERT INTO memory_relations
          (id, user_id, entity_a, relation, entity_b, strength, last_seen, source_conversation_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        crypto.randomUUID(),
        data.userId, data.entityA, data.relation, data.entityB,
        1, now,
        JSON.stringify([data.conversationId])
      )
      .run();
  }
}

export async function getRelationsForEntity(
  env: Env,
  userId: string,
  entity: string
): Promise<Relation[]> {
  const { results } = await env.MEMORY_DB
    .prepare(`
      SELECT * FROM memory_relations
      WHERE user_id = ? AND (entity_a = ? OR entity_b = ?)
      ORDER BY strength DESC
      LIMIT 20
    `)
    .bind(userId, entity, entity)
    .all<RelationRow>();
  return results.map(fromRow);
}

export async function countRelations(env: Env, userId: string): Promise<number> {
  const row = await env.MEMORY_DB
    .prepare("SELECT COUNT(*) as count FROM memory_relations WHERE user_id = ?")
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
