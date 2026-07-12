import type { Env } from "../env";
import type { ProfileEntry } from "../db/types";
import { extractFromConversation } from "../extraction/extract";
import { embedText } from "../embeddings/embed";
import { insertVector } from "../embeddings/vectorize";
import { insertConversation } from "../db/conversations";
import { insertFact, reinforceFact } from "../db/facts";
import { findSimilarFact } from "../db/dedup";
import { upsertRelation } from "../db/relations";
import { getProfile, upsertProfile } from "../db/profiles";

export interface ProcessRequest {
  user_id: string;
  conversation_id: string;
  messages: Array<{ role: string; content: unknown }>;
}

export async function processConversation(env: Env, req: ProcessRequest): Promise<void> {
  const { user_id, conversation_id, messages } = req;

  const extracted = await extractFromConversation(env, messages);
  if (!extracted) return;

  // Embed conversation summary for semantic recall
  let convEmbeddingId: string | undefined;
  try {
    const embedding = await embedText(env, extracted.summary);
    convEmbeddingId = `conv:${conversation_id}`;
    await insertVector(env, convEmbeddingId, embedding, {
      user_id,
      type:       "conversation",
      source_id:  conversation_id,
      importance: extracted.overallImportance,
    });
  } catch {
    // Embedding failure is non-fatal
  }

  await insertConversation(env, {
    id:           conversation_id,
    userId:       user_id,
    summary:      extracted.summary,
    keyPoints:    extracted.keyPoints,
    topics:       extracted.topics,
    participants: extracted.participants,
    importance:   extracted.overallImportance,
    messageCount: messages.filter((m) => m.role !== "system").length,
    embeddingId:  convEmbeddingId,
  });

  const identityEntries:   ProfileEntry[] = [];
  const preferenceEntries: ProfileEntry[] = [];

  for (const fact of extracted.facts) {
    // Embed first — needed for both dedup check and storage
    let embedding: number[] | undefined;
    let factEmbeddingId: string | undefined;
    const factId = crypto.randomUUID();

    try {
      embedding      = await embedText(env, fact.content);
      factEmbeddingId = `fact:${factId}`;
    } catch {}

    // Deduplication — if a semantically identical fact already exists in the
    // same category, reinforce it instead of creating a duplicate entry.
    if (embedding) {
      try {
        const duplicate = await findSimilarFact(env, embedding, user_id, fact.category);
        if (duplicate) {
          await reinforceFact(env, duplicate.factId, fact.importance);
          // Still collect identity/preference entries for profile merge even
          // when reinforcing — the profile merge deduplicates by content.
          if (fact.category === "identity")   identityEntries.push({ content: fact.content, importance: fact.importance });
          if (fact.category === "preference") preferenceEntries.push({ content: fact.content, importance: fact.importance });
          continue;
        }
      } catch {
        // Dedup failure is non-fatal — fall through to insert
      }
    }

    // Insert the vector before the D1 row so embedding_id is always valid
    if (embedding && factEmbeddingId) {
      try {
        await insertVector(env, factEmbeddingId, embedding, {
          user_id,
          type:       "fact",
          source_id:  factId,
          category:   fact.category,
          importance: fact.importance,
        });
      } catch {}
    }

    await insertFact(env, {
      id:                   factId,
      userId:               user_id,
      category:             fact.category,
      content:              fact.content,
      autoTags:             fact.tags,
      importance:           fact.importance,
      sourceType:           fact.source_type  ?? "inferred",
      decayRate:            fact.decay_rate   ?? "slow",
      sourceConversationId: conversation_id,
      embeddingId:          factEmbeddingId,
    });

    if (fact.category === "identity")   identityEntries.push({ content: fact.content, importance: fact.importance });
    if (fact.category === "preference") preferenceEntries.push({ content: fact.content, importance: fact.importance });
  }

  // Merge identity and preference facts into the profile.
  // upsertProfile handles importance-sorted deduplication and eviction.
  if (identityEntries.length > 0 || preferenceEntries.length > 0) {
    await upsertProfile(env, user_id, {
      identity:   identityEntries,
      preference: preferenceEntries,
    });
  }

  // Upsert entity relations
  for (const rel of extracted.relations) {
    await upsertRelation(env, {
      userId:         user_id,
      entityA:        rel.entityA,
      relation:       rel.relation,
      entityB:        rel.entityB,
      conversationId: conversation_id,
    }).catch(() => {});
  }
}
