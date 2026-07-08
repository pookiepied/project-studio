import { listSkills } from "../catalog/listSkills";
import type { Env } from "../../env";
import type { SkillSummary, SkillQuery } from "../types";

/**
 * Substring search across bundled + registered local skill *metadata*. The
 * cloud only indexes metadata (name, description, key, category) — never local
 * file content — so search results identify the skill and its source, and the
 * caller decides whether to skill_read (bundled) or skill_read_local (local).
 */
const FIELDS: (keyof SkillSummary)[] = ["key", "name", "description", "category"];

export async function searchSkills(
  env: Env,
  query: string,
  q: SkillQuery = {},
): Promise<SkillSummary[]> {
  if (!query || !query.trim()) return [];
  const needle = query.toLowerCase();
  const tokens = needle.split(/\s+/).filter(Boolean);

  const all = await listSkills(env, q);
  return all.filter((s) => {
    const haystack = FIELDS.map((f) => String(s[f] ?? "").toLowerCase()).join(" ");
    return tokens.every((tok) => haystack.includes(tok));
  });
}
