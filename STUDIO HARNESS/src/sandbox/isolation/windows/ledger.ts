import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { studioPath } from "../../../platform/paths.js";

/**
 * What containment has left on this machine, so a user can find it and remove it.
 *
 * ## Why a record exists at all
 *
 * Containing a workspace on Windows mints an AppContainer profile named
 * `studio-<sha256[0:32]>` and writes one access-control entry into the project
 * directory. `pnpm sandbox:release <project>` removes both, and **nothing calls
 * it automatically** — deleting a profile while a second Studio window is
 * working in the same project would strip that window's container mid-call, and
 * "cleaned up correctly" is not worth that.
 *
 * So the growth is bounded by the number of projects a user opens, and it is
 * real. The missing piece was never the removal, which works; it was that a
 * user had no way to *see* what existed. The profile name is a hash, so the
 * machine cannot tell them which project it belongs to — `studio-9f86d081…`
 * names nothing a person can act on.
 *
 * This file is that answer: the workspace path beside the profile it minted.
 *
 * ## The corridor
 *
 * Containment also grants per-workspace **traverse** entries on the ancestors
 * of everything the contained program touches — the workspace's own chain of
 * directories, the user's home folder among them. Those grants are remembered
 * in the running process so `release()` can undo them, but a process is exactly
 * the wrong place to keep them: `pnpm sandbox:release --stale` runs in a fresh
 * one, finds the in-memory set empty, and — before the corridor was recorded
 * here — revoked nothing while deleting the profile. Every entry it was built
 * to remove stayed on the disk, and the directory's permission list grew by one
 * per contained workspace, for ever.
 *
 * So the granted ancestors are written beside the profile, at grant time, and
 * release reads them back. This file is a log of what we know we did, never a
 * claim about the machine; the corridor is more of the same knowledge, recorded
 * at the moment we did it.
 *
 * ## Why a file, and not the database
 *
 * The sandbox does not own a table, and giving it one would put a storage
 * dependency inside the layer that has to work when the rest of the application
 * does not — `release()` runs from a maintenance command in a fresh process,
 * which is the case that matters most and the one with least around it.
 *
 * ## Why it is not the authority
 *
 * A record can be deleted, and a profile minted before this existed is not in
 * it. So this is a *log of what we know we did*, not a claim about what is on
 * the machine, and the listing says so rather than implying completeness it
 * cannot have. Enumerating the real profiles would mean reading them out of the
 * registry, which is a Windows-only surface and another thing to get wrong; if
 * a case appears where the record is not enough, that is the answer and it is a
 * separate piece of work.
 */

/** One profile, and the workspace it was minted for. */
export interface ProfileEntry {
  readonly name: string;
  readonly workspaceRoot: string;
  /** Milliseconds since the epoch, so a listing can be ordered by age. */
  readonly createdAt: number;
  /**
   * The corridor: ancestors this workspace was granted per-workspace traverse
   * on, so a `release` running in a process that never minted this profile can
   * still take them back. Recorded beside the profile, because the in-memory
   * set dies with the process that granted it, and the ancestors of a deleted
   * workspace cannot be re-derived from anything else we keep.
   *
   * **Absent means unknown, never nothing.** An entry written before the
   * corridor was recorded has no field, and a release must not read that as
   * "nothing to revoke" — that reading is the leak this field exists to close.
   * A present-but-empty array is a real measurement: every ancestor needed was
   * already covered by the machine-wide entry.
   */
  readonly traversed?: readonly string[];
}

function ledgerPath(): string {
  return studioPath("sandbox", "windows-profiles.json");
}

/**
 * Everything recorded, or nothing.
 *
 * A malformed or missing file reads as empty rather than throwing. This is a
 * convenience for the user, and a convenience that refuses to start is worse
 * than one that is briefly incomplete — containment itself must never depend on
 * it.
 *
 * An entry whose corridor field is malformed keeps its place with the field
 * dropped, rather than losing the whole row: the name and workspace are still
 * good, and a corridor that cannot be trusted is an *unknown* corridor, which
 * is a different thing from a broken record.
 */
export function readLedger(): readonly ProfileEntry[] {
  let text: string;
  try {
    text = readFileSync(ledgerPath(), "utf8");
  } catch {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const entries: ProfileEntry[] = [];
    for (const candidate of parsed) {
      const entry = readEntry(candidate);
      if (entry !== undefined) entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

/** Reads one candidate row, or refuses it. See `readLedger` for the rules. */
function readEntry(candidate: unknown): ProfileEntry | undefined {
  if (typeof candidate !== "object" || candidate === null) return undefined;
  if (!("name" in candidate) || typeof candidate.name !== "string") return undefined;
  if (!("workspaceRoot" in candidate) || typeof candidate.workspaceRoot !== "string") {
    return undefined;
  }
  if (!("createdAt" in candidate) || typeof candidate.createdAt !== "number") return undefined;

  const base: ProfileEntry = {
    name: candidate.name,
    workspaceRoot: candidate.workspaceRoot,
    createdAt: candidate.createdAt,
  };

  if (!("traversed" in candidate)) return base;
  const traversed = candidate.traversed;
  if (!isStringArray(traversed)) return base;
  return { ...base, traversed };
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function write(entries: readonly ProfileEntry[]): void {
  const path = ledgerPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(entries, undefined, 2)}\n`, "utf8");
}

/**
 * Records a profile, or leaves an existing record alone.
 *
 * Keyed on the workspace rather than the name so a re-entry keeps its original
 * `createdAt` — the age of a profile is the most useful thing in a listing, and
 * refreshing it on every launch would reset exactly the signal a user is
 * looking for.
 *
 * Never throws. A machine whose Studio home is read-only should still be able to
 * contain a program; losing the convenience is the right trade and losing the
 * sandbox is not.
 */
export function recordProfile(name: string, workspaceRoot: string): void {
  try {
    const entries = readLedger();
    if (entries.some((entry) => entry.workspaceRoot === workspaceRoot)) return;
    write([...entries, { name, workspaceRoot, createdAt: Date.now() }]);
  } catch {
    // Deliberately silent: see above.
  }
}

/**
 * Adds the ancestors a containment just granted per-workspace traverse on.
 *
 * Written at grant time, not at release time, because the reader of this field
 * is a `release` in a *different* process — the maintenance command, the test
 * teardown — and the process that granted the corridor is the one thing that
 * cannot be counted on to still be around when the corridor is owed back. The
 * in-memory set in `appcontainer.ts` is the same knowledge; this is the copy
 * that survives it.
 *
 * Merges rather than replaces: one workspace may be contained many times, with
 * different roots each time, and every ancestor ever granted is owed back.
 * Order is first-seen, so a listing (and a revocation) sees the corridor in the
 * order it grew. An empty merge still writes the field, because a corridor
 * measured as empty — every ancestor already covered by the machine-wide entry
 * — is a different fact from a corridor nobody recorded.
 *
 * No workspace recorded means nowhere to put the corridor, and inventing a row
 * here would fabricate a `createdAt` and a name for a profile this process
 * never saw minted. The corridor is lost from the record in that case; release
 * still measures the workspace's own ancestors, which is the backstop for
 * exactly this hole.
 *
 * Never throws: the same trade as `recordProfile`.
 */
export function recordTraversed(workspaceRoot: string, ancestors: readonly string[]): void {
  try {
    const entries = readLedger();
    const index = entries.findIndex((entry) => entry.workspaceRoot === workspaceRoot);
    if (index === -1) return;

    const existing = entries[index];
    if (existing === undefined) return;
    const known = existing.traversed;
    const merged = known === undefined
      ? [...ancestors]
      : [...known, ...ancestors.filter((ancestor) => !known.includes(ancestor))];
    // Nothing new to say, and the field is already there: no write, so a
    // contained command costs no ledger rewrite once the corridor is stable.
    if (known !== undefined && merged.length === known.length) return;

    const updated: ProfileEntry = { ...existing, traversed: merged };
    write([...entries.slice(0, index), updated, ...entries.slice(index + 1)]);
  } catch {
    // Deliberately silent: see above.
  }
}

/** Drops a workspace's record, after its profile has actually gone. */
export function forgetProfile(workspaceRoot: string): void {
  try {
    const entries = readLedger();
    const remaining = entries.filter((entry) => entry.workspaceRoot !== workspaceRoot);
    if (remaining.length !== entries.length) write(remaining);
  } catch {
    // As above. A stale record shows up in the listing as a workspace whose
    // profile is already gone, which is untidy and not harmful.
  }
}
