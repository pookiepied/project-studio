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
 */

interface Observation {
  /** The file's modification time when it was read. */
  readonly modifiedAt: number;
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
function keyOf(scope: ExecutionScope, path: string): string {
  const normalized = process.platform === "win32" ? path.toLowerCase() : path;
  return `${scope.conversationId}${SEPARATOR}${normalized}`;
}

export class FileAccessLog {
  readonly #seen = new Map<string, Observation>();

  /** Records that a call read this path, and the state it saw. */
  record(scope: ExecutionScope, path: string, observation: Observation): void {
    this.#seen.set(keyOf(scope, path), observation);
  }

  get(scope: ExecutionScope, path: string): Observation | undefined {
    return this.#seen.get(keyOf(scope, path));
  }

  /**
   * Refuses a modification to a file this conversation has not read, or has
   * read and which has since changed.
   *
   * A file that does not exist needs no prior read: there is nothing to
   * destroy, and requiring a read of a missing file would make creating one
   * impossible.
   */
  assertSafeToModify(
    scope: ExecutionScope,
    path: string,
    current: { exists: boolean; modifiedAt: number },
  ): void {
    if (!current.exists) return;

    const observed = this.#seen.get(keyOf(scope, path));

    if (!observed) {
      throw new ToolError("invalid_input", {
        message:
          "This file already exists and has not been read yet. Read it first, then modify it.",
      });
    }

    if (observed.modifiedAt !== current.modifiedAt) {
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
