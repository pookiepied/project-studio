import { createHash } from "node:crypto";

import type { ExecutionScope } from "../../contracts/capabilities.js";
import { ToolError } from "../errors.js";

/**
 * What each conversation has actually looked at.
 *
 * This exists to enforce one rule: **a file must be read before it is
 * overwritten or edited.** Without it a model that guessed a file's contents
 * would overwrite the real ones, and the user would lose work to a confident
 * guess. It is the same rule Claude Code enforces, for the same reason.
 *
 * It also catches the other half of the problem: a file that changed *after*
 * the model read it. Editing against a stale copy silently discards whatever
 * happened in between — a formatter run, another tool, the user typing.
 *
 * Scoped per conversation, because "I have seen this file" is knowledge held by
 * one agent in one conversation, and inheriting it across conversations would
 * let a subagent edit blind on the strength of a read it never performed.
 *
 * The instance must outlive a single run. Flue re-runs an agent's initializer
 * for every turn, so a log created there would forget everything between one
 * message and the next, and the model would have to re-read every file it
 * already read to change it — a token tax the rule was never meant to charge.
 * `StudioRuntime` keeps one log per conversation and hands the same one to
 * each run; see `#accessLogFor`.
 */

interface Observation {
  /** The file's modification time when it was read. */
  readonly modifiedAt: number;
  /**
   * The file's size in bytes when it was read.
   *
   * Cheap corroboration for the modification time, which is not as reliable
   * as it looks: FAT, exFAT, and some network shares keep timestamps to one
   * or two seconds, so two writes inside the same tick are indistinguishable
   * by time alone, and a writer that restores the timestamp (`touch -r`, some
   * build caches) changes a file without moving it at all. A different size
   * is proof of a different file, and it comes free with the stat we already
   * took.
   */
  readonly size: number;
  /**
   * A hash of the exact bytes that were seen, when they were in hand.
   *
   * Only recorded where the content was already read, which is every read and
   * every edit. `write` deliberately does not compute one: it would have to
   * read the whole file back purely to hash it before replacing it, and
   * paying that on every write to catch a same-size same-timestamp rewrite is
   * the wrong trade. Absent means "not known", never "unchanged".
   */
  readonly contentHash?: string;
}

/** The digest recorded beside a file, for content that is already in memory. */
export function hashContent(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * The separator between the conversation and the path.
 *
 * A null character, because it is the one byte that cannot appear in either
 * part — no filesystem allows it in a name, and a conversation id is a UUID.
 * A space could: conversation `a` with path `b c` and conversation `a b` with
 * path `c` produced one key, and this class exists precisely to keep one
 * conversation's read record away from another's.
 *
 * Written as the escape `\0` and not as a literal byte. An invisible control
 * character in source is read as a space by most viewers, and makes git and
 * grep treat the whole file as binary.
 */
const SEPARATOR = "\0";

/** Windows treats two spellings as one file, so the key must too. */
export function pathKey(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function keyOf(scope: ExecutionScope, path: string): string {
  return `${scope.conversationId}${SEPARATOR}${pathKey(path)}`;
}

/**
 * One writer at a time, per file.
 *
 * Every modification is a read-modify-write across several awaits: check the
 * log, read the content, compute the result, write it back. Two calls landing
 * on the same file interleave inside that window, both pass the staleness
 * check against the same pre-existing timestamp, and the second write lands on
 * top of the first — which is then reported as having succeeded, because it
 * did, briefly. Serializing by path closes the window without serializing
 * anything else: two different files still proceed together, and reads never
 * queue at all.
 *
 * Keyed by resolved path rather than by conversation, because the file is what
 * is being raced for. Two conversations sharing a project directory are two
 * writers to one file.
 */
export class PathLocks {
  readonly #chains = new Map<string, Promise<unknown>>();

  async run<T>(path: string, work: () => Promise<T>): Promise<T> {
    const key = pathKey(path);
    const previous = this.#chains.get(key);
    // Both arms run the work: a predecessor that threw has still finished, and
    // its failure is its caller's, not the next writer's.
    const attempt = previous === undefined ? work() : previous.then(work, work);
    // What the next caller waits on never rejects, so one failed write does
    // not poison the queue behind it.
    const settled = attempt.then(
      () => undefined,
      () => undefined,
    );
    this.#chains.set(key, settled);
    try {
      return await attempt;
    } finally {
      // Only the tail clears the entry, so the map does not grow with every
      // file the conversation has ever touched.
      if (this.#chains.get(key) === settled) this.#chains.delete(key);
    }
  }
}

export class FileAccessLog {
  readonly #seen = new Map<string, Observation>();
  readonly #locks = new PathLocks();

  /** Records that a call read this path, and the state it saw. */
  record(scope: ExecutionScope, path: string, observation: Observation): void {
    this.#seen.set(keyOf(scope, path), observation);
  }

  get(scope: ExecutionScope, path: string): Observation | undefined {
    return this.#seen.get(keyOf(scope, path));
  }

  /** Runs a modification with no other modification of the same file in flight. */
  serialize<T>(path: string, work: () => Promise<T>): Promise<T> {
    return this.#locks.run(path, work);
  }

  /**
   * Refuses a modification to a file this conversation has not read, or has
   * read and which has since changed.
   *
   * A file that does not exist needs no prior read: there is nothing to
   * destroy, and requiring a read of a missing file would make creating one
   * impossible.
   *
   * `contentHash` is the caller's hash of the bytes on disk right now, passed
   * only by callers that were reading the file anyway. Where it is present it
   * decides, because it is evidence rather than a proxy; where it is absent
   * the timestamp and the size answer together.
   */
  assertSafeToModify(
    scope: ExecutionScope,
    path: string,
    current: { exists: boolean; modifiedAt: number; size: number; contentHash?: string },
  ): void {
    if (!current.exists) return;

    const observed = this.#seen.get(keyOf(scope, path));

    if (!observed) {
      throw new ToolError("invalid_input", {
        message:
          "This file already exists and has not been read yet. Read it first, then modify it.",
      });
    }

    const changed =
      observed.contentHash !== undefined && current.contentHash !== undefined
        ? observed.contentHash !== current.contentHash
        : observed.modifiedAt !== current.modifiedAt || observed.size !== current.size;

    if (changed) {
      throw new ToolError("invalid_input", {
        message:
          "This file changed after it was read. Read it again before modifying it.",
      });
    }
  }

  /** Drops a conversation's history when it ends. */
  forget(conversationId: string): void {
    const prefix = `${conversationId}${SEPARATOR}`;
    for (const key of this.#seen.keys()) {
      if (key.startsWith(prefix)) this.#seen.delete(key);
    }
  }
}
