import * as v from "valibot";

import type { ConversationCreateInput } from "../contracts/conversations.js";
import type { ConversationRecord } from "../contracts/conversations.js";
import { reasoningChoiceSchema, type ReasoningChoice } from "../contracts/models.js";
import { isExecutionMode, type ExecutionMode } from "../permissions/mode.js";
import { StorageError, storageErrorFrom } from "../storage/errors.js";
import type { StudioDatabase } from "../storage/database.js";
import { deriveTitle } from "./title.js";

/**
 * The one owner of `conversation`.
 *
 * What this store is — and what it is not. Flue's conversation stream is the
 * sole canonical transcript ("adapters must not model a second authoritative
 * transcript"); nothing here stores text, and every read of the words goes to
 * the stream at `agents/studio/<id>`. What the product needs beyond that log
 * is an *index*: that the conversation exists, how it is titled in the
 * sidebar, where it is filed, whether it is pinned, archived, or gone. That
 * index cannot be rebuilt from anywhere else — Flue can address a stream it
 * is told about but cannot enumerate the ones it holds — so these rows are
 * the primary record of existence, and they are written at admission: a send
 * the harness refuses creates no id, no row, no sidebar entry (Task 33),
 * which makes "a row" and "a turn happened" the same boundary.
 *
 * Writes are idempotent by id because their callers retry: StrictMode mounts,
 * double clicks, and two windows admitting under one receipt all land here,
 * and a repeat must be the same conversation touched again rather than a
 * duplicate in the sidebar.
 */

interface Row {
  id: string;
  title: string | null;
  title_manual: number;
  project_id: string | null;
  pinned: number;
  archived: number;
  model_id: string | null;
  reasoning_level: string | null;
  permission_mode: string | null;
  created_at: number;
  last_turn_at: number;
}

/**
 * A stored reasoning choice, read back through the schema it was written
 * through. Null is the row's own "never settled" and a value that does not
 * parse reads the same way - an unreadable level must not become a level the
 * run asks for.
 */
function toReasoningChoice(value: string | null): ReasoningChoice | null {
  if (value === null) return null;
  const parsed = v.safeParse(reasoningChoiceSchema, value);
  return parsed.success ? parsed.output : null;
}

/**
 * The stored execution mode, read back as one of the three real ones.
 *
 * There is no null here on purpose: the column is nullable (migration 17
 * writes nothing a user did not choose), but an absent answer IS Manual - a
 * consent nobody recorded is a consent that was not given. A value that no
 * longer parses reads the same way, for the same reason an unreadable level
 * reads as unset: a corrupted answer must never widen what a run may do.
 */
function toExecutionMode(value: string | null): ExecutionMode {
  return isExecutionMode(value) ? value : "manual";
}

function toRecord(row: Row): ConversationRecord {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    titleManual: row.title_manual === 1,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    modelId: row.model_id,
    reasoningLevel: toReasoningChoice(row.reasoning_level),
    permissionMode: toExecutionMode(row.permission_mode),
    createdAt: row.created_at,
    lastTurnAt: row.last_turn_at,
  };
}

export interface ConversationListFilter {
  /** Null (default) lists everything; false hides the archive, true shows only it. */
  readonly archived?: boolean | null;
  readonly projectId?: string;
}

export class ConversationStore {
  readonly #db: StudioDatabase;

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  list(filter: ConversationListFilter = {}): readonly ConversationRecord[] {
    const archived =
      filter.archived === undefined || filter.archived === null
        ? undefined
        : filter.archived
          ? 1
          : 0;
    // Built rather than branched: two optional filters are four hand-written
    // statements, and the one that went unwritten was the bug — `projectId`
    // was declared here and read by nothing, so a caller asking for one
    // project's conversations was answered with everybody's.
    const where: string[] = [];
    const values: (string | number)[] = [];
    if (archived !== undefined) {
      where.push("archived = ?");
      values.push(archived);
    }
    if (filter.projectId !== undefined) {
      where.push("project_id = ?");
      values.push(filter.projectId);
    }
    try {
      return this.#rows(
        `SELECT * FROM conversation${
          where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`
        } ORDER BY last_turn_at DESC`,
        values,
      );
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  get(id: string): ConversationRecord | undefined {
    try {
      const row = this.#db.prepare("SELECT * FROM conversation WHERE id = ?").get(id);
      return row === undefined ? undefined : toRecord(row as unknown as Row);
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /**
   * Records that a harness-admitted first turn exists.
   *
   * The id was minted by the client and the stream named by it now exists;
   * this is the moment the sidebar learns about either. A repeat — the same
   * receipt delivered twice — updates the recency stamp and changes nothing
   * else: the first delivery already chose the title, the filing, and the
   * flags, and a duplicate on top of them would be a second row pointing at
   * one stream.
   */
  record(input: ConversationCreateInput): ConversationRecord {
    const existing = this.get(input.id);
    if (existing !== undefined) {
      // A repeat receipt touches recency and settles the settings the turn
      // named, so a record written by the admission path and the same receipt
      // arriving again converge on one row rather than fighting.
      const settled = this.#settledSettings(input);
      return settled === undefined
        ? this.touch(input.id, input.createdAt ?? Date.now())
        : this.patch(input.id, { ...settled, lastTurnAt: input.createdAt ?? Date.now() });
    }

    const row: Row = {
      id: input.id,
      // Derivation happens once per conversation, at creation, from the words
      // actually sent. `title_manual` starts false and stays false until a
      // person renames; see `patch`.
      title: deriveTitle(input.firstMessage) || null,
      title_manual: 0,
      project_id: input.projectId ?? null,
      pinned: 0,
      archived: 0,
      model_id: input.modelId ?? null,
      reasoning_level: input.reasoningLevel ?? null,
      permission_mode: input.permissionMode ?? null,
      created_at: input.createdAt ?? Date.now(),
      last_turn_at: input.createdAt ?? Date.now(),
    };

    try {
      this.#db.transaction(() => {
        this.#db
          .prepare(
            `INSERT INTO conversation (
               id, title, title_manual, project_id, pinned, archived,
               model_id, reasoning_level, permission_mode, created_at, last_turn_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            row.id,
            row.title,
            row.title_manual,
            row.project_id,
            row.pinned,
            row.archived,
            row.model_id,
            row.reasoning_level,
            row.permission_mode,
            row.created_at,
            row.last_turn_at,
          );
      });
    } catch (error) {
      // A foreign key against a project that does not exist lands here with
      // driver text attached; classify it before it reaches a response.
      throw storageErrorFrom(error, "conflict");
    }
    return this.get(input.id) as ConversationRecord;
  }

  /**
   * The settled half of a create input, when it carries one.
   *
   * Undefined means the caller sent nothing to settle, which must patch
   * nothing - a receipt without a model cannot clear one that admission
   * already wrote. An explicit null (clear to the default) is a value and
   * passes through.
   *
   * The project belongs here for a reason that is easy to miss. A first
   * message sent from a project page reaches the harness BEFORE the window
   * records the conversation, and the submission wire carries no project - so
   * admission always creates the row first, with no project on it, and the
   * `createConversation` receipt that follows is the only statement of which
   * project the conversation belongs to. Leaving it out of this settle filed
   * every project conversation under none: the sidebar showed it beside the
   * loose conversations and the project itself reported having none.
   */
  #settledSettings(
    input: ConversationCreateInput,
  ): {
    modelId?: string | null;
    reasoningLevel?: string | null;
    permissionMode?: ExecutionMode;
    projectId?: string | null;
  } | undefined {
    if (
      input.modelId === undefined &&
      input.reasoningLevel === undefined &&
      input.permissionMode === undefined &&
      input.projectId === undefined
    ) {
      return undefined;
    }
    return {
      ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
      ...(input.reasoningLevel === undefined ? {} : { reasoningLevel: input.reasoningLevel }),
      ...(input.permissionMode === undefined ? {} : { permissionMode: input.permissionMode }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    };
  }

  /**
   * Advances when a conversation last had a turn.
   *
   * Sent with every admission receipt after the first, for the same reason
   * `record` exists: recency sorting must survive a reload, which means it
   * has to be durable, which means it belongs beside the row.
   */
  touch(id: string, at: number): ConversationRecord {
    try {
      this.#db.transaction(() => {
        this.#db
          .prepare(
            `UPDATE conversation SET last_turn_at = MAX(last_turn_at, ?) WHERE id = ?`,
          )
          .run(at, id);
      });
    } catch (error) {
      throw storageErrorFrom(error);
    }
    const updated = this.get(id);
    if (updated === undefined) {
      throw new StorageError("not_found", { message: `No conversation "${id}" exists.` });
    }
    return updated;
  }

  /**
   * Applies a partial change.
   *
   * A rename sets `title_manual`, permanently: derivation names a
   * conversation once, at creation, from its own words, and anything a person
   * typed over it outranks the rule from then on. Clearing a title is not a
   * patch - null means "leave alone", the same convention the provider patch
   * uses for urls.
   */
  patch(
    id: string,
    change: {
      title?: string | undefined;
      pinned?: boolean | undefined;
      archived?: boolean | undefined;
      projectId?: string | null | undefined;
      modelId?: string | null | undefined;
      reasoningLevel?: string | null | undefined;
      permissionMode?: ExecutionMode | undefined;
      lastTurnAt?: number | undefined;
    },
  ): ConversationRecord {
    const current = this.get(id);
    if (current === undefined) {
      throw new StorageError("not_found", { message: `No conversation "${id}" exists.` });
    }

    const assignments: string[] = [];
    const values: (string | number | null)[] = [];

    if (change.title !== undefined) {
      assignments.push("title = ?", "title_manual = ?");
      values.push(change.title, 1);
    }
    if (change.pinned !== undefined) {
      assignments.push("pinned = ?");
      values.push(change.pinned ? 1 : 0);
    }
    if (change.archived !== undefined) {
      assignments.push("archived = ?");
      values.push(change.archived ? 1 : 0);
    }
    if (change.projectId !== undefined) {
      assignments.push("project_id = ?");
      values.push(change.projectId);
    }
    // The model and the reasoning level are what a turn was sent with. Each
    // is cleared by null back to the default, and neither is touched by an
    // absent key - a receipt that carries only a model cannot reset a level
    // somebody chose earlier.
    if (change.modelId !== undefined) {
      assignments.push("model_id = ?");
      values.push(change.modelId);
    }
    if (change.reasoningLevel !== undefined) {
      assignments.push("reasoning_level = ?");
      values.push(change.reasoningLevel);
    }
    // The mode has no null the way the model has: Manual is the bottom of the
    // scale rather than a clearing of it, so an absent key leaves the stored
    // answer alone and a named mode replaces it outright.
    if (change.permissionMode !== undefined) {
      assignments.push("permission_mode = ?");
      values.push(change.permissionMode);
    }
    // Recency is a patch like any other, because the only caller that has it
    // is the one sending the receipt of a later turn. Applied with MAX for the
    // same reason `touch` is: two windows stamping one conversation must not
    // let the slower receipt move it backwards.
    if (change.lastTurnAt !== undefined) {
      assignments.push("last_turn_at = MAX(last_turn_at, ?)");
      values.push(change.lastTurnAt);
    }

    if (assignments.length > 0) {
      try {
        this.#db.transaction(() => {
          this.#db
            .prepare(`UPDATE conversation SET ${assignments.join(", ")} WHERE id = ?`)
            .run(...values, id);
        });
      } catch (error) {
        // Filing into a project that does not exist is refused here rather
        // than silently dropped; SQLite's foreign key does the same below.
        throw storageErrorFrom(error, "conflict");
      }
    }
    return this.get(id) as ConversationRecord;
  }

  /**
   * Writes an automatic title, only while the conversation is still unnamed
   * by a person.
   *
   * The automatic titling agent and a person's rename can race - the model
   * works for a few seconds after the first exchange settles, and a rename
   * can land inside that window - so the guard lives in the statement rather
   * than around it: the row is written only while `title_manual` is still 0,
   * and a rename that arrived first wins without anyone re-reading. This is
   * deliberately not `patch` with a flag: `patch` sets `title_manual`, which
   * is the column's promise that a person typed the title, and a machine
   * write must not spend that promise.
   *
   * Undefined means the write did not happen - the row was renamed first,
   * or the row is gone (a conversation purged while its title job ran). Both
   * end the job; neither is a fault to surface.
   */
  titleAutomatically(id: string, title: string): ConversationRecord | undefined {
    try {
      this.#db.transaction(() => {
        this.#db
          .prepare(
            `UPDATE conversation SET title = ? WHERE id = ? AND title_manual = 0`,
          )
          .run(title, id);
      });
    } catch (error) {
      throw storageErrorFrom(error);
    }
    const row = this.get(id);
    if (row === undefined || row.titleManual) return undefined;
    return row;
  }

  /**
   * Removes rows outright.
   *
   * Called by emptying the archive over an explicit selection or all of it -
   * the one destructive path in the product, always a person choosing it -
   * and by the turn-settings middleware, which rolls back a row it created
   * for a first send the harness went on to refuse. There is no sweep and
   * nothing expires: an archive that quietly deletes is the one feature
   * nobody forgives.
   *
   * What removal destroys is answered by `conversations/purge.ts`, which owns
   * everything on disk besides these rows.
   */
  removeMany(ids: readonly string[]): readonly string[] {
    if (ids.length === 0) return [];
    try {
      const removed: string[] = [];
      this.#db.transaction(() => {
        const statement = this.#db.prepare("DELETE FROM conversation WHERE id = ?");
        for (const id of ids) {
          if (statement.run(id).changes > 0) removed.push(id);
        }
      });
      return removed;
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  count(archivedOnly = false): number {
    try {
      const row = this.#db
        .prepare(
          `SELECT COUNT(*) AS n FROM conversation${archivedOnly ? " WHERE archived = 1" : ""}`,
        )
        .get() as unknown as { n: number };
      return row.n;
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  #rows(sql: string, params: readonly (string | number)[] = []): readonly ConversationRecord[] {
    return (this.#db.prepare(sql).all(...params) as unknown as Row[]).map(toRecord);
  }
}
