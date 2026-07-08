import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { getProfile, upsertProfile } from "../db/profiles";
import { getRecentConversations, deleteConversation, countConversations } from "../db/conversations";
import {
  insertFact, getFactsByIds, listFacts, deleteFact, bulkDeleteFacts,
  countFactsByCategory, touchFacts,
} from "../db/facts";
import { getRelationsForEntity, countRelations } from "../db/relations";
import { embedText } from "../embeddings/embed";
import { insertVector, queryVectors, deleteVector } from "../embeddings/vectorize";
import { CATEGORIES, SOURCE_TYPES, DECAY_RATES } from "../db/types";
import type { ProfileEntry } from "../db/types";

export class StudioMemoryAgent extends McpAgent<Env> {
  server = new McpServer({
    name: "studio-memory",
    version: "1.0.0",
  });

  async init(): Promise<void> {

    // ── memory_recall ──────────────────────────────────────────────────────
    this.server.tool(
      "memory_recall",
      "Multi-layer memory retrieval. Returns profile, recent activity, and semantically relevant facts in one call. Primary tool for getting user context before responding.",
      {
        user_id: z.string(),
        query:   z.string().describe("Topic or current message to find relevant memories for."),
        limit:   z.number().int().min(1).max(20).optional().default(5),
      },
      async ({ user_id, query, limit }) => {
        const recentCount = parseInt(this.env.INJECT_RECENT_COUNT) || 3;
        const [profile, recent] = await Promise.all([
          getProfile(this.env, user_id),
          getRecentConversations(this.env, user_id, recentCount),
        ]);

        let relevant: Awaited<ReturnType<typeof getFactsByIds>> = [];
        let relevantIds: string[] = [];
        try {
          const embedding = await embedText(this.env, query);
          const matches   = await queryVectors(this.env, embedding, user_id, limit ?? 5);
          relevantIds = matches
            .filter((m) => m.metadata.type === "fact")
            .map((m) => m.metadata.source_id as string);
          relevant = await getFactsByIds(this.env, relevantIds);
        } catch {}

        // Record access for decay tracking — fire-and-forget
        if (relevantIds.length > 0) {
          touchFacts(this.env, relevantIds).catch(() => {});
        }

        const result = {
          profile:  { identity: profile.identity, preference: profile.preference },
          recent:   recent.map((c) => ({ date: c.createdAt.slice(0, 10), summary: c.summary, topics: c.topics })),
          relevant: relevant.map((f) => ({
            category:   f.category,
            content:    f.content,
            tags:       f.autoTags,
            importance: f.importance,
            sourceType: f.sourceType,
          })),
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
    );

    // ── memory_search ──────────────────────────────────────────────────────
    this.server.tool(
      "memory_search",
      "Semantic vector search across all memory facts. Returns ranked results by relevance.",
      {
        user_id:  z.string(),
        query:    z.string(),
        category: z.enum(CATEGORIES).optional(),
        limit:    z.number().int().min(1).max(20).optional().default(8),
      },
      async ({ user_id, query, category, limit }) => {
        const embedding = await embedText(this.env, query);
        const matches   = await queryVectors(this.env, embedding, user_id, (limit ?? 8) * 2);
        const factIds   = matches
          .filter((m) => m.metadata.type === "fact")
          .filter((m) => !category || m.metadata.category === category)
          .slice(0, limit ?? 8)
          .map((m) => m.metadata.source_id as string);
        const facts = await getFactsByIds(this.env, factIds);

        // Record access fire-and-forget
        if (factIds.length > 0) {
          touchFacts(this.env, factIds).catch(() => {});
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({ facts, query }) }] };
      }
    );

    // ── memory_recent ──────────────────────────────────────────────────────
    this.server.tool(
      "memory_recent",
      "Get the most recent conversation summaries, newest first.",
      {
        user_id: z.string(),
        limit:   z.number().int().min(1).max(20).optional().default(5),
      },
      async ({ user_id, limit }) => {
        const conversations = await getRecentConversations(this.env, user_id, limit ?? 5);
        return { content: [{ type: "text" as const, text: JSON.stringify({ conversations }) }] };
      }
    );

    // ── memory_profile ─────────────────────────────────────────────────────
    this.server.tool(
      "memory_profile",
      "Get or update the user's core profile (identity + preferences). Profile is auto-injected on every conversation.",
      {
        user_id: z.string(),
        updates: z.object({
          identity:   z.array(z.string()).optional(),
          preference: z.array(z.string()).optional(),
        }).optional(),
      },
      async ({ user_id, updates }) => {
        if (updates) {
          // Strings passed via the tool get a higher default importance (7) than
          // auto-extracted facts (5) since they are explicitly noted by the AI.
          const toEntries = (arr?: string[]): ProfileEntry[] =>
            (arr ?? []).map((content) => ({ content, importance: 7 }));

          await upsertProfile(this.env, user_id, {
            identity:   updates.identity   ? toEntries(updates.identity)   : undefined,
            preference: updates.preference ? toEntries(updates.preference) : undefined,
          });
        }
        const profile = await getProfile(this.env, user_id);
        return { content: [{ type: "text" as const, text: JSON.stringify(profile) }] };
      }
    );

    // ── memory_note ────────────────────────────────────────────────────────
    this.server.tool(
      "memory_note",
      "Explicitly save a fact to STUDIO Memory. Use when the user says 'remember this' or something important should be persisted immediately.",
      {
        user_id:         z.string(),
        content:         z.string().describe("The fact as a self-contained sentence."),
        category:        z.enum(CATEGORIES),
        importance:      z.number().int().min(1).max(10).optional().default(5),
        source_type:     z.enum(SOURCE_TYPES).optional().default("stated"),
        decay_rate:      z.enum(DECAY_RATES).optional().default("slow"),
        expires_in_days: z.number().int().min(1).optional().describe("Auto-delete after N days. Omit for permanent."),
      },
      async ({ user_id, content, category, importance, source_type, decay_rate, expires_in_days }) => {
        const id        = crypto.randomUUID();
        const expiresAt = expires_in_days
          ? new Date(Date.now() + expires_in_days * 86_400_000).toISOString()
          : undefined;

        let embeddingId: string | undefined;
        try {
          const embedding = await embedText(this.env, content);
          embeddingId = `fact:${id}`;
          await insertVector(this.env, embeddingId, embedding, {
            user_id, type: "fact", source_id: id, category, importance: importance ?? 5,
          });
        } catch {}

        await insertFact(this.env, {
          id,
          userId:     user_id,
          category,
          content,
          autoTags:   [],
          importance: importance ?? 5,
          sourceType: source_type ?? "stated",
          decayRate:  decay_rate  ?? "slow",
          embeddingId,
          expiresAt,
        });

        return { content: [{ type: "text" as const, text: JSON.stringify({ saved: true, id, category }) }] };
      }
    );

    // ── memory_relate ──────────────────────────────────────────────────────
    this.server.tool(
      "memory_relate",
      "Query the entity relationship graph. Returns all known relationships for a named entity (person, project, tool, concept).",
      {
        user_id: z.string(),
        entity:  z.string().describe("Entity name to look up (e.g. 'Studio', 'Cloudflare', 'TypeScript')."),
      },
      async ({ user_id, entity }) => {
        const relations = await getRelationsForEntity(this.env, user_id, entity);
        return { content: [{ type: "text" as const, text: JSON.stringify({ entity, relations }) }] };
      }
    );

    // ── memory_timeline ────────────────────────────────────────────────────
    this.server.tool(
      "memory_timeline",
      "Get conversation summaries in time order. Use for 'what happened last week?' or 'what did I work on in May?'",
      {
        user_id:   z.string(),
        limit:     z.number().int().min(1).max(50).optional().default(10),
        from_date: z.string().optional().describe("Start date YYYY-MM-DD (inclusive)."),
        to_date:   z.string().optional().describe("End date YYYY-MM-DD (inclusive)."),
      },
      async ({ user_id, limit, from_date, to_date }) => {
        let query   = "SELECT id, summary, topics, created_at FROM memory_conversations WHERE user_id = ?";
        const params: unknown[] = [user_id];
        if (from_date) { query += " AND created_at >= ?"; params.push(from_date); }
        if (to_date)   { query += " AND created_at <= ?"; params.push(to_date + "T23:59:59Z"); }
        query += " ORDER BY created_at DESC LIMIT ?";
        params.push(limit ?? 10);

        const { results } = await this.env.MEMORY_DB
          .prepare(query).bind(...params)
          .all<{ id: string; summary: string; topics: string; created_at: string }>();

        const events = results.map((r) => ({
          date:    r.created_at.slice(0, 10),
          summary: r.summary,
          topics:  JSON.parse(r.topics),
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify({ events, total: events.length }) }] };
      }
    );

    // ── memory_list ────────────────────────────────────────────────────────
    this.server.tool(
      "memory_list",
      "Browse memory facts filtered by category and/or tag.",
      {
        user_id:  z.string(),
        category: z.enum(CATEGORIES).optional(),
        tag:      z.string().optional(),
        limit:    z.number().int().min(1).max(50).optional().default(20),
        offset:   z.number().int().min(0).optional().default(0),
      },
      async ({ user_id, category, tag, limit, offset }) => {
        const result = await listFacts(this.env, user_id, { category, tag, limit, offset });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
    );

    // ── memory_delete ──────────────────────────────────────────────────────
    this.server.tool(
      "memory_delete",
      "Delete a specific memory fact or conversation record by ID.",
      {
        user_id: z.string(),
        id:      z.string(),
        type:    z.enum(["fact", "conversation"]),
      },
      async ({ user_id, id, type }) => {
        let deleted = false;
        if (type === "fact") {
          deleted = await deleteFact(this.env, user_id, id);
          if (deleted) await deleteVector(this.env, `fact:${id}`).catch(() => {});
        } else {
          deleted = await deleteConversation(this.env, user_id, id);
          if (deleted) await deleteVector(this.env, `conv:${id}`).catch(() => {});
        }
        return { content: [{ type: "text" as const, text: JSON.stringify({ deleted, id, type }) }] };
      }
    );

    // ── memory_forget ──────────────────────────────────────────────────────
    this.server.tool(
      "memory_forget",
      "Bulk delete memory facts matching a tag, category, or date range.",
      {
        user_id:     z.string(),
        tag:         z.string().optional(),
        category:    z.enum(CATEGORIES).optional(),
        before_date: z.string().optional().describe("YYYY-MM-DD — delete facts created before this date."),
      },
      async ({ user_id, tag, category, before_date }) => {
        const count = await bulkDeleteFacts(this.env, user_id, { tag, category, beforeDate: before_date });
        return { content: [{ type: "text" as const, text: JSON.stringify({ deleted_count: count }) }] };
      }
    );

    // ── memory_stats ───────────────────────────────────────────────────────
    this.server.tool(
      "memory_stats",
      "Returns memory counts by category, total conversations, and relations. Useful for diagnostics.",
      {
        user_id: z.string(),
      },
      async ({ user_id }) => {
        const [facts, convCount, relCount, recent] = await Promise.all([
          countFactsByCategory(this.env, user_id),
          countConversations(this.env, user_id),
          countRelations(this.env, user_id),
          getRecentConversations(this.env, user_id, 1),
        ]);
        const stats = {
          facts,
          conversations:  convCount,
          relations:      relCount,
          last_processed: recent[0]?.createdAt ?? null,
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }] };
      }
    );
  }
}
