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
    return parsed.filter(
      (entry): entry is ProfileEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as ProfileEntry).name === "string" &&
        typeof (entry as ProfileEntry).workspaceRoot === "string" &&
        typeof (entry as ProfileEntry).createdAt === "number",
    );
  } catch {
    return [];
  }
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
