import type { Env } from "../env";
import type { ProfileEntry, ProfileFacts } from "./types";

export type { ProfileFacts };

const PROFILE_MAX = 20;

export async function getProfile(env: Env, userId: string): Promise<ProfileFacts> {
  const cached = await env.PROFILE_KV.get(`profile:${userId}`);
  if (cached) {
    try {
      return normalizeLegacyProfile(JSON.parse(cached));
    } catch {}
  }

  const row = await env.MEMORY_DB
    .prepare("SELECT facts_json FROM memory_profiles WHERE user_id = ?")
    .bind(userId)
    .first<{ facts_json: string }>();

  const raw    = row ? JSON.parse(row.facts_json) : { identity: [], preference: [] };
  const facts  = normalizeLegacyProfile(raw);

  await env.PROFILE_KV.put(`profile:${userId}`, JSON.stringify(facts), { expirationTtl: 300 });
  return facts;
}

/**
 * Merges new ProfileEntry lists into the stored profile.
 * - Deduplicates by exact content (keeps the higher importance of the two)
 * - Sorts by importance descending so the most important facts survive eviction
 * - Caps each list at PROFILE_MAX entries
 */
export async function upsertProfile(
  env: Env,
  userId: string,
  updates: { identity?: ProfileEntry[]; preference?: ProfileEntry[] }
): Promise<void> {
  const existing = await getProfile(env, userId);
  const merged: ProfileFacts = {
    identity:   mergeEntries(existing.identity,   updates.identity   ?? []),
    preference: mergeEntries(existing.preference, updates.preference ?? []),
  };

  await env.MEMORY_DB
    .prepare(`
      INSERT INTO memory_profiles (user_id, facts_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE
        SET facts_json = excluded.facts_json,
            updated_at = excluded.updated_at
    `)
    .bind(userId, JSON.stringify(merged), new Date().toISOString())
    .run();

  await env.PROFILE_KV.delete(`profile:${userId}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Handles DBs written before the ProfileEntry migration where arrays
 * contained plain strings. Converts them to { content, importance: 5 }.
 */
function normalizeLegacyProfile(raw: unknown): ProfileFacts {
  const r = raw as Record<string, unknown>;
  return {
    identity:   normalizeEntries(r.identity),
    preference: normalizeEntries(r.preference),
  };
}

function normalizeEntries(arr: unknown): ProfileEntry[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((item) =>
    typeof item === "string"
      ? { content: item, importance: 5 }
      : (item as ProfileEntry)
  );
}

/**
 * Merges two ProfileEntry arrays, deduplicating by content and sorting by
 * importance so the highest-value facts are never the ones evicted at cap.
 */
function mergeEntries(existing: ProfileEntry[], incoming: ProfileEntry[]): ProfileEntry[] {
  const map = new Map<string, ProfileEntry>();

  for (const entry of existing) {
    map.set(entry.content, entry);
  }
  for (const entry of incoming) {
    const prev = map.get(entry.content);
    map.set(entry.content, {
      content:    entry.content,
      importance: prev ? Math.max(prev.importance, entry.importance) : entry.importance,
    });
  }

  return Array.from(map.values())
    .sort((a, b) => b.importance - a.importance)
    .slice(0, PROFILE_MAX);
}
