import type { SkillSummary, SkillQuery } from "../types";

/**
 * Filter a merged skill list by the caller's runtime.
 *
 * "cloud"  → only skills allowed to run in the cloud (allowed_runtime ∈ cloud|both).
 *            Local-only skills (e.g. desktop automation) are hidden — the cloud
 *            agent cannot act on them, and the desktop skill must only be
 *            surfaced once a Computer Use / local runtime is active.
 *
 * "local"  → everything visible, including local-only skills, since the local
 *            runtime can act on them.
 */
export function filterSkillsForRuntime(
  skills: SkillSummary[],
  query: SkillQuery,
): SkillSummary[] {
  const runtime = query.runtime ?? "cloud";
  if (runtime === "local") return skills;
  return skills.filter((s) => s.allowedRuntime === "cloud" || s.allowedRuntime === "both");
}
