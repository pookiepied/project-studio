import { getBundledSummaries } from "../bundled/bundledCatalog";
import { listRegistrations, rowToSummary } from "../../storage/queries";
import { resolveSkillPrecedence } from "./resolveSkillPrecedence";
import { filterSkillsForRuntime } from "./filterSkillsForRuntime";
import type { Env } from "../../env";
import type { SkillSummary, SkillQuery } from "../types";

/**
 * Assemble the full, precedence-resolved, runtime-filtered skill catalog for
 * a user. This is the single read path behind /internal/skills/list,
 * /internal/skills/index, skill_list, and skill_search.
 *
 * Bundled (system) skills are always compiled in. Local registrations are
 * pulled from D1 (metadata only) and merged with strict precedence — local
 * shadows bundled, duplicates are surfaced (not merged) for debugging.
 */
export async function listSkills(env: Env, query: SkillQuery = {}): Promise<SkillSummary[]> {
  const bundled = getBundledSummaries();

  const local = query.userId
    ? (await listRegistrations(env, query.userId, {
        deviceId: query.deviceId,
        includeDisabled: false,
      })).map(rowToSummary)
    : [];

  const merged = resolveSkillPrecedence(bundled, local);
  return filterSkillsForRuntime(merged, query);
}
