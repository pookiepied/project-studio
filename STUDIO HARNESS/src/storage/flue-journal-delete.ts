import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { StorageError, storageErrorFrom } from "./errors.js";

/**
 * The write half for Flue's durable journal, and the only place in the
 * codebase that may write to `flue.db`.
 *
 * `flue.db` belongs to Flue: the harness holds it open for the life of the
 * process through the persistence adapter in `src/db.ts`, and Flue exposes no
 * supported deletion surface (re-checked against `@flue/runtime` and
 * `@flue/sdk` on 2026-09-04: still none). The read half
 * (`storage/flue-journal.ts`) is deliberately read-only for exactly that
 * reason, and this module exists because Task 53 decided to reach past it
 * anyway - narrowly, and on purpose. Deleting a conversation must destroy its
 * transcript, and there is no other way to do it. Everything that touches
 * `flue.db` with a write lives in this file so the exception stays countable:
 * one module, only DELETE statements, only rows keyed to one conversation id.
 *
 * ---- How the write is serialized against Flue's own -----------------------
 *
 * Flue keeps its own write connection open for the whole process lifetime
 * (WAL mode, no busy timeout). This module opens a second, dedicated write
 * connection per delete and closes it before returning - never held open, so
 * there is no second long-lived writer to drift out of sync with the first.
 *
 * The connection sets `PRAGMA busy_timeout = 5000` and runs the whole delete
 * inside one `BEGIN IMMEDIATE` transaction. IMMEDIATE takes the RESERVED lock
 * up front, which does two things: our wait (up to five seconds) absorbs a
 * Flue write that is already in flight instead of failing on it, and Flue's
 * next write waits on us rather than interleaving rows into a conversation
 * that is halfway deleted. The window is milliseconds - a handful of DELETEs
 * over rows already collected - and a Flue write that lands inside it fails
 * fast on Flue's side (its connection sets no busy timeout). That failure is
 * acceptable because deletes are rare, human-initiated acts, and a running
 * conversation is refused outright (below), so the colliding write is always
 * some other conversation's turn, which Flue's own retry and reconciliation
 * re-drive. `tests/unit/flue-journal-delete.test.ts` proves the shape: it
 * deletes while a live Flue adapter holds the same file open and writes for
 * another conversation concurrently, not only against a closed fixture.
 *
 * ---- What "belongs to a conversation" means --------------------------------
 *
 * A stream path is `agents/<agentName>/<conversationId>`, and one
 * conversation has more than one stream - every conversation here has
 * `agents/studio/<id>`, and most also have `agents/title/<id>` from the
 * titling agent. Matching targets the id across every agent name, never one
 * constructed path.
 *
 * A submission's `session_key` is a JSON string such as
 * `agent-session:["studio","cnv_4swkkfjx","default","default"]`, and the
 * conversation id is its second element. There is no column for it and no
 * index on it, so the match is done by reading the keys and parsing them,
 * not by pattern matching in SQL.
 *
 * Path matching is exact or it is a data-loss bug: `cnv_abc` must never match
 * `cnv_abcd`. Candidate paths are read out and their segments compared in
 * code; no statement here uses LIKE, GLOB, or a prefix comparison, and the
 * DELETEs address the collected exact values with IN lists. The near-miss
 * case has its own test, which is there to be broken on purpose.
 *
 * ---- A conversation with an active run cannot be deleted -------------------
 *
 * Deleting the transcript of a turn in flight is the worst case this module
 * can produce, so the active check runs first, inside the same IMMEDIATE
 * transaction as the deletes: any submission for this conversation whose
 * status is anything but `settled` refuses the whole delete with a
 * `conflict` error, and the rollback leaves every row in place. The check is
 * fail-closed - an unknown future status blocks rather than passes - and the
 * truth is the journal's own `status` column, never the client's `running`
 * set. A refusal is a real error with a code (`storage.conflict`), not a
 * silent no-op.
 */

const SESSION_KEY_PREFIX = "agent-session:";

/** Tables the match logic requires; absent means this file is not a journal. */
const REQUIRED_TABLES = [
  "flue_conversation_streams",
  "flue_conversation_stream_batches",
  "flue_agent_submissions",
] as const;

/** Rows destroyed for one conversation, per journal table. */
export interface FlueJournalDeleteCounts {
  readonly streams: number;
  readonly batches: number;
  readonly batchChunks: number;
  readonly foldCheckpoints: number;
  readonly foldCheckpointChunks: number;
  readonly attachments: number;
  readonly attachmentChunks: number;
  readonly submissions: number;
  readonly submissionChunks: number;
}

const EMPTY_COUNTS: FlueJournalDeleteCounts = {
  streams: 0,
  batches: 0,
  batchChunks: 0,
  foldCheckpoints: 0,
  foldCheckpointChunks: 0,
  attachments: 0,
  attachmentChunks: 0,
  submissions: 0,
  submissionChunks: 0,
};

export interface FlueJournalDeleteResult {
  readonly conversationId: string;
  /** Every stream path matched, across all agent names. */
  readonly streamPaths: readonly string[];
  /** Every submission matched through its session key. */
  readonly submissionIds: readonly string[];
  readonly counts: FlueJournalDeleteCounts;
}

/**
 * Whether the path names a stream of this conversation: exactly
 * `agents/<agent>/<id>`, with the id compared whole, never by prefix.
 */
export function streamPathBelongsTo(path: string, conversationId: string): boolean {
  const segments = path.split("/");
  return (
    segments.length === 3 && segments[0] === "agents" && segments[2] === conversationId
  );
}

/**
 * Whether the session key carries this conversation: the id is the second
 * element of the JSON array after the `agent-session:` prefix, compared
 * whole. Anything unparseable belongs to nobody.
 */
export function sessionKeyBelongsTo(sessionKey: string, conversationId: string): boolean {
  if (!sessionKey.startsWith(SESSION_KEY_PREFIX)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(sessionKey.slice(SESSION_KEY_PREFIX.length));
  } catch {
    return false;
  }
  return (
    Array.isArray(parsed) && parsed.length >= 2 && parsed[1] === conversationId
  );
}

function rejectBadId(conversationId: string): void {
  if (
    conversationId.trim() === "" ||
    conversationId.includes("/") ||
    conversationId.includes("\\")
  ) {
    throw new StorageError("invalid", {
      message: `"${conversationId}" is not a conversation id this install can delete.`,
    });
  }
}

function tableNames(handle: DatabaseSync): Set<string> {
  const rows = handle
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as unknown as { name: unknown }[];
  const names = new Set<string>();
  for (const row of rows) {
    if (typeof row.name === "string") names.add(row.name);
  }
  return names;
}

function placeholders(count: number): string {
  return new Array<string>(count).fill("?").join(", ");
}

/**
 * Whether this conversation has a turn in flight, read from the journal's
 * own submission statuses. Fail-closed: any status but `settled` counts as
 * active, including ones this build has never seen.
 */
export function hasActiveFlueSubmissions(
  flueDatabasePath: string,
  conversationId: string,
): boolean {
  rejectBadId(conversationId);
  if (!existsSync(flueDatabasePath)) return false;

  let handle: DatabaseSync;
  try {
    handle = new DatabaseSync(flueDatabasePath, { readOnly: true });
  } catch (error) {
    throw storageErrorFrom(error, "unavailable");
  }
  try {
    handle.exec("PRAGMA busy_timeout = 5000");
    const present = tableNames(handle);
    if (!present.has("flue_agent_submissions")) return false;
    const rows = handle
      .prepare("SELECT session_key, status FROM flue_agent_submissions")
      .all() as unknown as { session_key: unknown; status: unknown }[];
    return rows.some(
      (row) =>
        typeof row.session_key === "string" &&
        sessionKeyBelongsTo(row.session_key, conversationId) &&
        row.status !== "settled",
    );
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw storageErrorFrom(error, "internal");
  } finally {
    handle.close();
  }
}

/**
 * Destroys every journal row keyed to one conversation, in one transaction.
 *
 * Throws `conflict` when a turn is in flight (nothing is destroyed) and
 * `invalid` when the id cannot name a conversation or the file holds no
 * journal. A missing file is success with zero counts: Flue creates the
 * journal at boot, so a conversation that exists while its journal does not
 * has no transcript to destroy.
 */
export function deleteFlueJournalForConversation(
  flueDatabasePath: string,
  conversationId: string,
): FlueJournalDeleteResult {
  rejectBadId(conversationId);
  if (!existsSync(flueDatabasePath)) {
    return { conversationId, streamPaths: [], submissionIds: [], counts: EMPTY_COUNTS };
  }

  let handle: DatabaseSync;
  try {
    handle = new DatabaseSync(flueDatabasePath);
  } catch (error) {
    throw storageErrorFrom(error, "unavailable");
  }

  try {
    handle.exec("PRAGMA busy_timeout = 5000");
    handle.exec("PRAGMA foreign_keys = ON");

    const present = tableNames(handle);
    const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
    if (missing.length > 0) {
      throw new StorageError("invalid", {
        message:
          `The file at ${flueDatabasePath} does not hold a Flue journal: missing ` +
          `${missing.join(", ")}.`,
      });
    }
    // Tables beyond the required three are touched only when present.
    // Older journals (the beta line the export fixture mirrors) lack the
    // chunk, fold, and attachment tables; skipping a missing table there is
    // correct, because there is nothing in it to delete.
    const has = (table: string): boolean => present.has(table);

    // The BEGIN is inside the guarded region on purpose: acquiring RESERVED
    // against a Flue write that is already in flight waits out the busy
    // timeout and then fails here, where it becomes a retryable `unavailable`
    // rather than a raw driver error.
    let begun = false;
    try {
      handle.exec("BEGIN IMMEDIATE");
      begun = true;
      const submissionRows = handle
        .prepare("SELECT submission_id, session_key, status FROM flue_agent_submissions")
        .all() as unknown as {
        submission_id: unknown;
        session_key: unknown;
        status: unknown;
      }[];
      const submissionIds: string[] = [];
      for (const row of submissionRows) {
        if (
          typeof row.submission_id !== "string" ||
          typeof row.session_key !== "string"
        ) {
          continue;
        }
        if (!sessionKeyBelongsTo(row.session_key, conversationId)) continue;
        if (row.status !== "settled") {
          throw new StorageError("conflict", {
            message:
              `Conversation "${conversationId}" has a turn in flight, so it ` +
              "cannot be deleted. Stop the turn first and try again.",
          });
        }
        submissionIds.push(row.submission_id);
      }

      const streamRows = handle
        .prepare("SELECT path FROM flue_conversation_streams")
        .all() as unknown as { path: unknown }[];
      const streamPaths: string[] = [];
      for (const row of streamRows) {
        if (
          typeof row.path === "string" &&
          streamPathBelongsTo(row.path, conversationId)
        ) {
          streamPaths.push(row.path);
        }
      }

      const counts: { -readonly [key in keyof FlueJournalDeleteCounts]: number } = {
        ...EMPTY_COUNTS,
      };

      if (has("flue_conversation_stream_batch_chunks") && streamPaths.length > 0) {
        counts.batchChunks = Number(
          handle
            .prepare(
              `DELETE FROM flue_conversation_stream_batch_chunks WHERE path IN (${placeholders(streamPaths.length)})`,
            )
            .run(...streamPaths).changes,
        );
      }
      if (streamPaths.length > 0) {
        counts.batches = Number(
          handle
            .prepare(
              `DELETE FROM flue_conversation_stream_batches WHERE path IN (${placeholders(streamPaths.length)})`,
            )
            .run(...streamPaths).changes,
        );
        counts.streams = Number(
          handle
            .prepare(
              `DELETE FROM flue_conversation_streams WHERE path IN (${placeholders(streamPaths.length)})`,
            )
            .run(...streamPaths).changes,
        );
      }

      if (has("flue_conversation_fold_checkpoint_chunks") && streamPaths.length > 0) {
        counts.foldCheckpointChunks = Number(
          handle
            .prepare(
              `DELETE FROM flue_conversation_fold_checkpoint_chunks WHERE path IN (${placeholders(streamPaths.length)})`,
            )
            .run(...streamPaths).changes,
        );
      }
      if (has("flue_conversation_fold_checkpoints") && streamPaths.length > 0) {
        counts.foldCheckpoints = Number(
          handle
            .prepare(
              `DELETE FROM flue_conversation_fold_checkpoints WHERE path IN (${placeholders(streamPaths.length)})`,
            )
            .run(...streamPaths).changes,
        );
      }

      if (has("flue_attachments")) {
        if (has("flue_attachment_chunks")) {
          counts.attachmentChunks = Number(
            handle
              .prepare(
                "DELETE FROM flue_attachment_chunks WHERE stream_path IN " +
                  "(SELECT stream_path FROM flue_attachments WHERE conversation_id = ?)",
              )
              .run(conversationId).changes,
          );
          if (streamPaths.length > 0) {
            counts.attachmentChunks += Number(
              handle
                .prepare(
                  `DELETE FROM flue_attachment_chunks WHERE stream_path IN (${placeholders(streamPaths.length)})`,
                )
                .run(...streamPaths).changes,
            );
          }
        }
        counts.attachments = Number(
          handle
            .prepare(
              streamPaths.length > 0
                ? `DELETE FROM flue_attachments WHERE conversation_id = ? OR stream_path IN (${placeholders(streamPaths.length)})`
                : "DELETE FROM flue_attachments WHERE conversation_id = ?",
            )
            .run(conversationId, ...streamPaths).changes,
        );
      }

      if (has("flue_submission_chunks") && submissionIds.length > 0) {
        counts.submissionChunks = Number(
          handle
            .prepare(
              `DELETE FROM flue_submission_chunks WHERE submission_id IN (${placeholders(submissionIds.length)})`,
            )
            .run(...submissionIds).changes,
        );
      }
      if (submissionIds.length > 0) {
        counts.submissions = Number(
          handle
            .prepare(
              `DELETE FROM flue_agent_submissions WHERE submission_id IN (${placeholders(submissionIds.length)})`,
            )
            .run(...submissionIds).changes,
        );
      }

      handle.exec("COMMIT");
      return { conversationId, streamPaths, submissionIds, counts };
    } catch (error) {
      // The rollback may not be the caller's problem to hear about. SQLite
      // aborts the transaction itself on some errors, and a ROLLBACK issued
      // after that raises "cannot rollback - no transaction is active" -
      // which, thrown from here, would replace the error that actually
      // stopped the delete. The refusal a person needs to read ("this
      // conversation has a turn in flight") must survive the cleanup that
      // follows it, so the rollback's own failure is swallowed and the
      // original cause is the one that leaves this function.
      if (begun) {
        try {
          handle.exec("ROLLBACK");
        } catch {
          // Already rolled back, or the connection is gone. Either way the
          // transaction is not committed, which is the guarantee that
          // matters, and `close()` in the finally releases the rest.
        }
      }
      if (error instanceof StorageError) throw error;
      throw storageErrorFrom(error, "internal");
    }
  } finally {
    handle.close();
  }
}
