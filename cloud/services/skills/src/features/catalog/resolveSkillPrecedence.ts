import type { SkillSummary } from "../types";

/**
 * Deterministic precedence for merging skills that share the same key.
 *
 * Cloud registrations only ever see two ranks at the catalog level:
 *   bundled (scope=system) ... rank 0
 *   local   (scope=local) ... rank 1   — local shadows bundled
 *
 * The finer project-vs-home path precedence is a *local scanner* concern: by
 * the time a local skill is registered here it already represents one resolved
 * path. We never silently merge or overwrite: sibling duplicates are returned
 * alongside the winner, each tagged `shadowedBy` so the UI / debugger can show
 * why one won.
 *
 * Output order: winning entry first per key, shadowed siblings after, then
 * all unique keys in their original input order (bundled first, then local).
 */
const RANK: Record<string, number> = { system: 0, local: 1 };

function sourceLabel(s: SkillSummary): string {
  if (s.sourceType === "bundled") return `bundled:${s.key}`;
  return `${s.sourceType}:${s.localPath ?? s.sourceUrl ?? s.key}`;
}

export function resolveSkillPrecedence(
  bundled: SkillSummary[],
  local: SkillSummary[],
): SkillSummary[] {
  const ordered = [...bundled, ...local];
  const byKey = new Map<string, SkillSummary[]>();
  for (const s of ordered) {
    const arr = byKey.get(s.key) ?? [];
    arr.push(s);
    byKey.set(s.key, arr);
  }

  const out: SkillSummary[] = [];
  for (const arr of byKey.values()) {
    // Highest rank wins; ties resolve to the earliest (bundled before local).
    const sorted = arr
      .map((s, idx) => ({ s, idx, rank: RANK[s.scope] ?? 0 }))
      .sort((a, b) => b.rank - a.rank || a.idx - b.idx);

    const winner = sorted[0];
    out.push(winner.s);
    const winnerLabel = sourceLabel(winner.s);
    for (let i = 1; i < sorted.length; i++) {
      out.push({ ...sorted[i].s, shadowedBy: winnerLabel });
    }
  }
  return out;
}
