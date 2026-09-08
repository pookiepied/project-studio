import { existsSync } from "node:fs";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { ToolError } from "../errors.js";

/**
 * The Studio-owned trash: where a delete puts a path the snapshot history
 * cannot reach.
 *
 * The shadow repository's work tree is the workspace root, so a delete there
 * is covered - the gate takes the restore point before the tool runs, and the
 * history records what was removed. A path outside that root (a folder the
 * user granted, the machine's own directories) has no such history, and
 * destroying it outright would make delete the one filesystem operation with
 * no answer to "how do I get this back". So the delete tool moves it here
 * rather than removing it, and says in its result where it went.
 *
 * The two mechanisms are chosen by the path and never overlap: inside the
 * workspace root the file is removed and the snapshot history is the
 * recovery; outside it the file is moved here and this trash is the only
 * recovery. No path is covered by both.
 *
 * The real Windows Recycle Bin was considered and refused. Reaching it means
 * the shell API - `SHFileOperation` / `IFileOperation` - which from Node is a
 * native module or a spawned helper, and its own semantics are against us:
 * it is per user and per volume, so a file on a network share or a second
 * drive may silently bypass it. A mechanism that sometimes quietly works is
 * worse than one that always does what it says. This trash is ordinary
 * filesystem work - rename where the volume allows, copy then remove where
 * it does not - so it behaves identically for every path the sandbox will
 * resolve, and it never claims a recovery it did not perform.
 *
 * ## Layout
 *
 * One directory per delete, named for the moment it happened and made unique
 * against two deletes in the same millisecond. Inside it, exactly two fixed
 * names: `content`, the moved file or directory under a name that cannot
 * collide with anything (its original name may itself have been
 * `origin.json`), and `origin.json`, recording the original absolute path,
 * the name it had there, and when and by whom it was deleted. The payload's
 * bytes are untouched either way.
 *
 * ## Retention
 *
 * Entries live inside the conversation's own directory, so the purge of a
 * conversation destroys them with the rest of its tree, and until then
 * nothing expires them - the same doctrine `conversations/purge.ts` states
 * for every other file under that tree. No second retention mechanism, no
 * sweep, and no table: the directory itself is the record.
 *
 * The sandbox is not involved below, and that is deliberate. The path being
 * moved was resolved and authorized through `resolveWrite` by the gate; the
 * destination is our own state, derived from the conversation id, which no
 * policy root names and no policy root should. A sandbox primitive that
 * could write outside every root would be a hole; this function is the one
 * caller, and its destination is not agent-chosen.
 */

/** The manifest written beside every trashed payload. */
export interface TrashOrigin {
  /** The absolute path the payload was moved from. */
  readonly originalPath: string;
  /** The payload's name at that path. */
  readonly originalName: string;
  /** When the delete happened, in milliseconds since the epoch. */
  readonly deletedAt: number;
  /** The conversation whose delete it was. */
  readonly conversationId: string;
}

export interface TrashEntry {
  /** The entry directory, `origin.json` and `content` beside each other in it. */
  readonly path: string;
}

const MANIFEST_NAME = "origin.json";
const PAYLOAD_NAME = "content";

/**
 * A timestamped, collision-checked entry name.
 *
 * Two deletes can land in the same millisecond, and a directory tree cannot
 * hold two entries of one name, so the timestamp is checked against what is
 * on disk and widened with a counter until it is free. The name is for people
 * browsing, not for anything that reads it back - `origin.json` is.
 */
function entryName(trashRoot: string, deletedAt: number): string {
  const stamp = new Date(deletedAt).toISOString().replace(/[:.]/g, "-");
  let name = stamp;
  let attempt = 0;
  while (existsSync(join(trashRoot, name))) {
    attempt += 1;
    name = `${stamp}-${attempt}`;
  }
  return name;
}

/**
 * Moves one path into the trash, returning the entry it became.
 *
 * The move is rename-first: on the same volume it is one filesystem
 * operation regardless of size. Across a volume boundary rename fails with
 * `EXDEV`, and the payload is copied first and removed second - the original
 * survives every failure of the copy, so a full disk or a locked file leaves
 * the file where it was and the delete reports failure rather than loss.
 * A partially written entry from such a failure is removed, again best-effort;
 * the original is never the thing cleaned up.
 */
export async function moveToTrash(
  target: string,
  trashRoot: string,
  origin: Omit<TrashOrigin, "originalName">,
): Promise<TrashEntry> {
  const deletedAt = origin.deletedAt;
  await mkdir(trashRoot, { recursive: true });

  const entry = join(trashRoot, entryName(trashRoot, deletedAt));
  const payload = join(entry, PAYLOAD_NAME);

  try {
    await mkdir(entry, { recursive: true });
    try {
      await rename(target, payload);
    } catch (error) {
      // `EXDEV` is rename's own answer to a volume boundary, and the one
      // failure that has a second, safe way through. Everything else is
      // re-raised below with the entry cleaned up.
      if ((error as NodeJS.ErrnoException)?.code !== "EXDEV") throw error;
      await cp(target, payload, { recursive: true, errorOnExist: true, force: false });
      await rm(target, { recursive: true, force: true });
    }

    const manifest: TrashOrigin = {
      ...origin,
      originalName: basename(target),
    };
    await writeFile(join(entry, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  } catch (error) {
    // Best-effort, and aimed only at the entry: whatever happened, the
    // original is either still at `target` or fully copied, and the one
    // thing that must not happen is a cleanup that deepens the loss.
    await rm(entry, { recursive: true, force: true }).catch(() => undefined);
    throw new ToolError("execution_failed", {
      message: "The file could not be moved to the trash, so it was left in place.",
      cause: error,
    });
  }

  return { path: entry };
}
