import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { StorageError, storageErrorFrom } from "./errors.js";
import {
  sessionKeyBelongsTo,
  streamPathBelongsTo,
} from "./flue-journal-delete.js";

/**
 * The second writer to Flue's durable journal, beside the deleter
 * (`storage/flue-journal-delete.ts`): where the deleter destroys one
 * conversation's rows, this module duplicates them under a new id for a
 * fork. The same serialization discipline applies - one dedicated write
 * connection per call, `PRAGMA busy_timeout = 5000`, the whole copy inside
 * one `BEGIN IMMEDIATE` transaction - for the same reason: Flue holds the
 * file open for the process lifetime, and a copy interleaved with one of its
 * writes would duplicate a moving target.
 *
 * ---- What travels, and what pointedly does not ---------------------------
 *
 * Streams, batches, batch chunks and attachments travel. Every row is
 * addressed by exact stream path (`agents/<agent>/<id>`, matched with the
 * deleter's whole-segment matcher, never LIKE), and batch and chunk rows go
 * over byte-identical: the fold that replays them is per-stream state
 * (`recordsById`, scope ownership), so records the source already folded
 * fold again under the new path with nothing rewritten. The one field that
 * is rewritten is the stream identity's `instanceId`: a later send
 * authorizes its submission against the stream identity, and an identity
 * still naming the source would refuse every turn the fork ever starts.
 *
 * Fold checkpoints do not travel. A checkpoint is strictly a cache over the
 * log - never authoritative, rebuilt by replay when absent - so the fork's
 * first history read re-folds from the copied batches the way any cold open
 * does, and writes its own checkpoint afterwards.
 *
 * Submissions do not travel. They are write-time coordination: the append
 * fence reads them when a turn runs, and history never joins them. Their
 * ids are globally unique, so a verbatim copy is impossible anyway, and a
 * rewritten one would have to rewrite every submission, attempt, operation
 * and message id woven through the batch records to stay consistent. The
 * copied batches keep naming the source's settled submissions as inert
 * history; the fork's own turns admit fresh submissions under its own
 * session key, which is exactly what continuing an old conversation after a
 * restart already does.
 *
 * ---- The truncation form --------------------------------------------------
 *
 * "Branch from here" copies a prefix: with `upToSubmissionId`, each stream
 * carrying that submission is cut after its last batch, and the new stream's
 * `nextOffset` continues from the cut so the next turn appends exactly
 * there. Streams that never carried the submission go over whole - the title
 * thread is not the visible transcript, and cutting it would invent a
 * boundary its own turns never had. A fold is prefix-closed (a prefix of a
 * valid log folds valid), so the cut stream reads exactly as the source
 * read at that point. An id no stream of the source carried is invalid, not
 * an empty fork: branching at a message that is not there is the caller's
 * bug, and an empty transcript would look like success.
 */

const REQUIRED_TABLES = [
  "flue_conversation_streams",
  "flue_conversation_stream_batches",
  "flue_agent_submissions",
] as const;

/** Columns the copy reads; absent means this file is not a live journal. */
const STREAM_COLUMNS = [
  "path",
  "identity_json",
  "next_offset",
  "producer_id",
  "producer_epoch",
  "next_producer_sequence",
  "incarnation",
] as const;

const BATCH_COLUMNS = [
  "path",
  "seq",
  "producer_id",
  "producer_epoch",
  "producer_sequence",
  "data",
  "submission_id",
  "attempt_id",
] as const;

/** Rows duplicated for one conversation, per journal table. */
export interface FlueJournalCopyCounts {
  readonly streams: number;
  readonly batches: number;
  readonly batchChunks: number;
  readonly attachments: number;
  readonly attachmentChunks: number;
}

const EMPTY_COUNTS: FlueJournalCopyCounts = {
  streams: 0,
  batches: 0,
  batchChunks: 0,
  attachments: 0,
  attachmentChunks: 0,
};

export interface FlueJournalCopyResult {
  readonly sourceId: string;
  readonly conversationId: string;
  /** Every new stream path written, across all agent names. */
  readonly streamPaths: readonly string[];
  readonly counts: FlueJournalCopyCounts;
}

export interface FlueJournalCopyOptions {
  /**
   * Branch-at-submission: copy each stream only through the last batch of
   * this submission. Absent copies whole streams.
   */
  readonly upToSubmissionId?: string;
}

function rejectBadId(conversationId: string): void {
  if (
    conversationId.trim() === "" ||
    conversationId.includes("/") ||
    conversationId.includes("\\")
  ) {
    throw new StorageError("invalid", {
      message: `"${conversationId}" is not a conversation id this install can fork.`,
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

function columnNames(handle: DatabaseSync, table: string): Set<string> {
  const rows = handle.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
    name: unknown;
  }[];
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
 * The new stream identity: the source's, with the instance renamed.
 *
 * Key order is preserved (replacing a value never moves it), so the stored
 * text differs from the source's in the id alone. An identity that is not
 * JSON or names no instance goes over verbatim: nothing here knows a shape
 * it cannot read, and inventing one would be the lie this copy refuses to
 * tell anywhere else.
 */
export function rewriteStreamIdentity(
  identityJson: string,
  sourceId: string,
  targetId: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(identityJson);
  } catch {
    return identityJson;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return identityJson;
  }
  const record = parsed as Record<string, unknown>;
  if (record["instanceId"] !== sourceId) return identityJson;
  return JSON.stringify({ ...record, instanceId: targetId });
}

interface SourceStream {
  readonly path: string;
  readonly targetPath: string;
  readonly identityJson: string;
  readonly nextOffset: number;
  readonly producerId: string | null;
  readonly producerEpoch: number;
  readonly nextProducerSequence: number;
  readonly incarnation: string;
}

/**
 * Duplicates one conversation's journal rows under a new id, in one
 * transaction.
 *
 * Throws `conflict` when a turn is in flight (nothing is duplicated) or a
 * stream for the target already exists, and `invalid` when an id cannot
 * name a conversation, the file holds no live journal, or
 * `upToSubmissionId` names no submission of the source. A missing file is
 * success with zero counts, as in the deleter: Flue creates the journal at
 * boot, so a conversation that exists while its journal does not has no
 * transcript to duplicate.
 */
export function copyFlueJournalForConversation(
  flueDatabasePath: string,
  sourceId: string,
  targetId: string,
  options: FlueJournalCopyOptions = {},
): FlueJournalCopyResult {
  rejectBadId(sourceId);
  rejectBadId(targetId);
  if (sourceId === targetId) {
    throw new StorageError("invalid", {
      message: "A conversation cannot be forked onto itself.",
    });
  }
  const upToSubmissionId = options.upToSubmissionId;
  if (upToSubmissionId !== undefined && upToSubmissionId.trim() === "") {
    throw new StorageError("invalid", {
      message: "A branch point must name a submission.",
    });
  }

  if (!existsSync(flueDatabasePath)) {
    return { sourceId, conversationId: targetId, streamPaths: [], counts: EMPTY_COUNTS };
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
    const has = (table: string): boolean => present.has(table);
    const streamColumns = columnNames(handle, "flue_conversation_streams");
    const absentStreamColumns = STREAM_COLUMNS.filter(
      (column) => !streamColumns.has(column),
    );
    if (absentStreamColumns.length > 0) {
      throw new StorageError("invalid", {
        message:
          "The Flue journal's stream table does not have the live shape: " +
          `missing ${absentStreamColumns.join(", ")}.`,
      });
    }
    const batchColumns = columnNames(handle, "flue_conversation_stream_batches");
    const absentBatchColumns = BATCH_COLUMNS.filter(
      (column) => !batchColumns.has(column),
    );
    if (absentBatchColumns.length > 0) {
      throw new StorageError("invalid", {
        message:
          "The Flue journal's batch table does not have the live shape: " +
          `missing ${absentBatchColumns.join(", ")}.`,
      });
    }

    // The BEGIN is inside the guarded region on purpose, as in the deleter:
    // acquiring RESERVED against a Flue write already in flight waits out
    // the busy timeout and then fails here, where it becomes a retryable
    // `unavailable` rather than a raw driver error.
    let begun = false;
    try {
      handle.exec("BEGIN IMMEDIATE");
      begun = true;

      const submissionRows = handle
        .prepare("SELECT session_key, status FROM flue_agent_submissions")
        .all() as unknown as { session_key: unknown; status: unknown }[];
      for (const row of submissionRows) {
        if (
          typeof row.session_key !== "string" ||
          !sessionKeyBelongsTo(row.session_key, sourceId)
        ) {
          continue;
        }
        if (row.status !== "settled") {
          throw new StorageError("conflict", {
            message:
              `Conversation "${sourceId}" has a turn in flight, so it ` +
              "cannot be forked. Stop the turn first and try again.",
          });
        }
      }

      const streamRows = handle
        .prepare(
          "SELECT path, identity_json, next_offset, producer_id, " +
            "producer_epoch, next_producer_sequence, incarnation " +
            "FROM flue_conversation_streams",
        )
        .all() as unknown as {
        path: unknown;
        identity_json: unknown;
        next_offset: unknown;
        producer_id: unknown;
        producer_epoch: unknown;
        next_producer_sequence: unknown;
        incarnation: unknown;
      }[];
      const sources: SourceStream[] = [];
      for (const row of streamRows) {
        if (typeof row.path !== "string" || !streamPathBelongsTo(row.path, sourceId)) {
          continue;
        }
        if (
          typeof row.identity_json !== "string" ||
          typeof row.next_offset !== "number" ||
          (row.producer_id !== null && typeof row.producer_id !== "string") ||
          typeof row.producer_epoch !== "number" ||
          typeof row.next_producer_sequence !== "number" ||
          typeof row.incarnation !== "string"
        ) {
          throw new StorageError("invalid", {
            message:
              `The Flue journal's stream row at ${row.path} does not have ` +
              "the live shape.",
          });
        }
        const segments = row.path.split("/");
        sources.push({
          path: row.path,
          targetPath: [...segments.slice(0, -1), targetId].join("/"),
          identityJson: row.identity_json,
          nextOffset: row.next_offset,
          producerId: row.producer_id,
          producerEpoch: row.producer_epoch,
          nextProducerSequence: row.next_producer_sequence,
          incarnation: row.incarnation,
        });
      }

      if (sources.length > 0) {
        const targetPaths = sources.map((source) => source.targetPath);
        const clashing = handle
          .prepare(
            `SELECT path FROM flue_conversation_streams WHERE path IN (${placeholders(targetPaths.length)})`,
          )
          .all(...targetPaths) as unknown as { path: unknown }[];
        if (clashing.length > 0) {
          throw new StorageError("conflict", {
            message:
              `Conversation "${targetId}" already has journal streams, so it ` +
              "cannot be the fork of another conversation.",
          });
        }
      }

      // The branch cut per stream: the last batch carrying the submission,
      // or whole-stream when the submission never ran there. Unknown to
      // every stream is the caller's bug, refused rather than forked empty.
      const cutoffs = new Map<string, number>();
      if (upToSubmissionId !== undefined) {
        for (const source of sources) {
          const row = handle
            .prepare(
              "SELECT MAX(seq) AS cutoff FROM flue_conversation_stream_batches " +
                "WHERE path = ? AND submission_id = ?",
            )
            .get(source.path, upToSubmissionId) as unknown as {
            cutoff: unknown;
          };
          if (typeof row.cutoff === "number") cutoffs.set(source.path, row.cutoff);
        }
        if (cutoffs.size === 0) {
          throw new StorageError("invalid", {
            message:
              `Submission "${upToSubmissionId}" names no turn of conversation ` +
              `"${sourceId}".`,
          });
        }
      }

      const counts: { -readonly [key in keyof FlueJournalCopyCounts]: number } = {
        ...EMPTY_COUNTS,
      };

      for (const source of sources) {
        const cutoff = cutoffs.get(source.path);
        handle
          .prepare(
            "INSERT INTO flue_conversation_streams " +
              "(path, identity_json, next_offset, producer_id, producer_epoch, " +
              "next_producer_sequence, incarnation) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            source.targetPath,
            rewriteStreamIdentity(source.identityJson, sourceId, targetId),
            // A cut stream continues from the cut: its batches run 0..cutoff,
            // so the next turn appends at cutoff + 1, exactly where the
            // named answer ended.
            cutoff === undefined ? source.nextOffset : cutoff + 1,
            source.producerId,
            source.producerEpoch,
            source.nextProducerSequence,
            source.incarnation,
          );
        counts.streams += 1;

        const batches =
          cutoff === undefined
            ? handle
                .prepare(
                  "INSERT INTO flue_conversation_stream_batches " +
                    "(path, seq, producer_id, producer_epoch, producer_sequence, " +
                    "data, submission_id, attempt_id) " +
                    "SELECT ?, seq, producer_id, producer_epoch, producer_sequence, " +
                    "data, submission_id, attempt_id " +
                    "FROM flue_conversation_stream_batches WHERE path = ?",
                )
                .run(source.targetPath, source.path)
            : handle
                .prepare(
                  "INSERT INTO flue_conversation_stream_batches " +
                    "(path, seq, producer_id, producer_epoch, producer_sequence, " +
                    "data, submission_id, attempt_id) " +
                    "SELECT ?, seq, producer_id, producer_epoch, producer_sequence, " +
                    "data, submission_id, attempt_id " +
                    "FROM flue_conversation_stream_batches WHERE path = ? AND seq <= ?",
                )
                .run(source.targetPath, source.path, cutoff);
        counts.batches += Number(batches.changes);

        if (has("flue_conversation_stream_batch_chunks")) {
          const chunks =
            cutoff === undefined
              ? handle
                  .prepare(
                    "INSERT INTO flue_conversation_stream_batch_chunks " +
                      "(path, seq, chunk_index, chunk_count, data) " +
                      "SELECT ?, seq, chunk_index, chunk_count, data " +
                      "FROM flue_conversation_stream_batch_chunks WHERE path = ?",
                  )
                  .run(source.targetPath, source.path)
              : handle
                  .prepare(
                    "INSERT INTO flue_conversation_stream_batch_chunks " +
                      "(path, seq, chunk_index, chunk_count, data) " +
                      "SELECT ?, seq, chunk_index, chunk_count, data " +
                      "FROM flue_conversation_stream_batch_chunks WHERE path = ? AND seq <= ?",
                  )
                  .run(source.targetPath, source.path, cutoff);
          counts.batchChunks += Number(chunks.changes);
        }
      }

      // Attachments are keyed to streams, not to turns: a branch carries
      // the whole stream's pictures, including ones later turns added past
      // the cut. Unreferenced bytes are harmless - the fork's transcript
      // never names them, and the purge removes them with the stream.
      if (has("flue_attachments") && sources.length > 0) {
        const sourcePaths = sources.map((source) => source.path);
        const pathCase = `CASE stream_path ${sources
          .map(() => "WHEN ? THEN ?")
          .join(" ")} END`;
        const pathValues = sources.flatMap((source) => [source.path, source.targetPath]);
        counts.attachments += Number(
          handle
            .prepare(
              "INSERT INTO flue_attachments " +
                "(stream_path, attachment_id, mime_type, byte_size, digest, " +
                "conversation_id, chunk_count, created_at) " +
                "SELECT " +
                `${pathCase}, attachment_id, mime_type, byte_size, digest, ` +
                "conversation_id, chunk_count, created_at " +
                `FROM flue_attachments WHERE stream_path IN (${placeholders(sourcePaths.length)})`,
            )
            .run(...pathValues, ...sourcePaths).changes,
        );
        if (has("flue_attachment_chunks")) {
          const chunkCase = `CASE stream_path ${sources
            .map(() => "WHEN ? THEN ?")
            .join(" ")} END`;
          counts.attachmentChunks += Number(
            handle
              .prepare(
                "INSERT INTO flue_attachment_chunks " +
                  "(stream_path, attachment_id, chunk_index, bytes) " +
                  `SELECT ${chunkCase}, attachment_id, chunk_index, bytes ` +
                  "FROM flue_attachment_chunks " +
                  `WHERE stream_path IN (${placeholders(sourcePaths.length)})`,
              )
              .run(...pathValues, ...sourcePaths).changes,
          );
        }
      }

      handle.exec("COMMIT");
      return {
        sourceId,
        conversationId: targetId,
        streamPaths: sources.map((source) => source.targetPath),
        counts,
      };
    } catch (error) {
      // The rollback's own failure must never replace the error that
      // stopped the copy - see the deleter for why this swallows.
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
