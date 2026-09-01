import { statSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import { flueDatabasePath, resolveConfigured } from "../platform/paths.js";
import { StorageError, storageErrorFrom } from "./errors.js";

/**
 * The read-only reader for Flue's durable journal.
 *
 * `flue.db` belongs to Flue (`platform/paths.ts` records why the two
 * databases are separate files), and the Flue 2.0 upgrade rejects any
 * database older than schema 8 outright. Everything Studio has ever
 * transcribed lives in this one file, so before the upgrade it is read out,
 * and the read must be the safest kind there is: a connection opened with
 * SQLite's read-only flag, which cannot write, checkpoint the WAL, or create
 * anything. The journal is never repaired, migrated, or tidied here - an
 * export that mutates the thing it is rescuing would be the bug it exists to
 * prevent.
 *
 * This module is in `src/storage` because it is the one place a raw
 * `DatabaseSync` may live. It exposes rows, not SQL; the shape of the tables
 * inside is Flue's business and was read from the beta runtime's own store
 * (`conversation-stream-store.ts`), not assumed from a migration guide. The
 * reader verifies the tables it was written against actually exist before
 * answering any query, because an export run against the wrong file must fail
 * with a name, not with an empty result.
 */

/** One row of `flue_conversation_streams`. */
export interface FlueJournalStreamRow {
  readonly path: string;
  readonly identityJson: string;
  readonly nextOffset: number;
}

/** One row of `flue_conversation_stream_batches`. */
export interface FlueJournalBatchRow {
  readonly path: string;
  readonly seq: number;
  readonly data: string;
  readonly submissionId: string | null;
  readonly attemptId: string | null;
}

/** One row of `flue_agent_submissions`. */
export interface FlueJournalSubmissionRow {
  readonly submissionId: string;
  readonly kind: string;
  readonly status: string;
  readonly payload: string | null;
  readonly error: string | null;
  readonly acceptedAt: number | null;
  readonly settledAt: number | null;
}

export interface FlueJournalReader {
  /** The file that was opened, as given. */
  readonly path: string;
  /**
   * The journal's own `flue_meta.schema_version`, verbatim, or null when the
   * table or key is absent. Recorded in the export because the shapes that
   * follow depend on it.
   */
  readonly schemaVersion: string | null;
  listStreams(): readonly FlueJournalStreamRow[];
  readBatches(streamPath: string): readonly FlueJournalBatchRow[];
  listSubmissions(): readonly FlueJournalSubmissionRow[];
  close(): void;
}

/**
 * Where the journal lives, by the same rule the write-side connection in
 * `db.ts` follows: `PROJECT_STUDIO_DB_PATH` overrides, everything else is the
 * fixed path in the Studio home.
 */
export function resolveFlueJournalPath(): string {
  return process.env.PROJECT_STUDIO_DB_PATH
    ? resolveConfigured(process.env.PROJECT_STUDIO_DB_PATH)
    : flueDatabasePath();
}

const REQUIRED_TABLES = [
  "flue_meta",
  "flue_conversation_streams",
  "flue_conversation_stream_batches",
  "flue_agent_submissions",
] as const;

type SqlRow = Record<string, SQLOutputValue>;

function isRowWith(
  row: SqlRow | undefined,
  columns: readonly string[],
): row is SqlRow {
  if (row === undefined) return false;
  return columns.every((column) => column in row);
}

function textColumn(row: SqlRow, column: string, table: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new StorageError("invalid", {
      message:
        `The Flue journal table ${table} has a ${column} that is not text ` +
        `(found ${value === null ? "null" : typeof value}). The journal's ` +
        "shape is not the one this reader was written against.",
    });
  }
  return value;
}

function numberColumn(row: SqlRow, column: string, table: string): number {
  const value = row[column];
  if (typeof value !== "number") {
    throw new StorageError("invalid", {
      message:
        `The Flue journal table ${table} has a ${column} that is not a ` +
        `number (found ${value === null ? "null" : typeof value}).`,
    });
  }
  return value;
}

function textOrNullColumn(
  row: SqlRow,
  column: string,
  table: string,
): string | null {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new StorageError("invalid", {
      message:
        `The Flue journal table ${table} has a ${column} that is neither ` +
        `text nor null (found ${typeof value}).`,
    });
  }
  return value;
}

function numberOrNullColumn(
  row: SqlRow,
  column: string,
  table: string,
): number | null {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== "number") {
    throw new StorageError("invalid", {
      message:
        `The Flue journal table ${table} has a ${column} that is neither a ` +
        `number nor null (found ${typeof value}).`,
    });
  }
  return value;
}

/**
 * Opens the journal read-only and hands back the narrow row reader.
 *
 * Refuses a missing file or a file that does not hold the journal, because
 * both are configuration mistakes a person is standing behind and an empty
 * export would look like success.
 */
export function openFlueJournal(path: string): FlueJournalReader {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw new StorageError("unavailable", {
      message:
        `The Flue journal was not found at ${path}. Check the path; the ` +
        "journal is never created by an export.",
    });
  }
  if (size === 0) {
    throw new StorageError("unavailable", {
      message: `The file at ${path} is empty and holds no journal.`,
    });
  }

  let handle: DatabaseSync;
  try {
    handle = new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    throw storageErrorFrom(error, "unavailable");
  }

  try {
    // A journal may still be mid-write by a running harness; a reader waits
    // briefly rather than failing a rescue for contention. Connection-scoped,
    // so this writes nothing to the file.
    handle.exec("PRAGMA busy_timeout = 5000");

    const present = handle
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row["name"]);
    const missing = REQUIRED_TABLES.filter((table) => !present.includes(table));
    if (missing.length > 0) {
      throw new StorageError("invalid", {
        message:
          `The file at ${path} does not hold a Flue journal: missing ` +
          `${missing.join(", ")}.`,
      });
    }

    const metaRow = handle
      .prepare("SELECT value FROM flue_meta WHERE key = 'schema_version'")
      .get();
    const schemaVersion = isRowWith(metaRow, ["value"])
      ? textColumn(metaRow, "value", "flue_meta")
      : null;

    const reader: FlueJournalReader = {
      path,
      schemaVersion,

      listStreams(): readonly FlueJournalStreamRow[] {
        const rows = handle
          .prepare(
            "SELECT path, identity_json, next_offset " +
              "FROM flue_conversation_streams ORDER BY path",
          )
          .all();
        return rows.map((row) => {
          if (!isRowWith(row, ["path", "identity_json", "next_offset"])) {
            throw new StorageError("invalid", {
              message: "A flue_conversation_streams row is missing columns.",
            });
          }
          return {
            path: textColumn(row, "path", "flue_conversation_streams"),
            identityJson: textColumn(
              row,
              "identity_json",
              "flue_conversation_streams",
            ),
            nextOffset: numberColumn(
              row,
              "next_offset",
              "flue_conversation_streams",
            ),
          };
        });
      },

      readBatches(streamPath: string): readonly FlueJournalBatchRow[] {
        const rows = handle
          .prepare(
            "SELECT path, seq, data, submission_id, attempt_id " +
              "FROM flue_conversation_stream_batches " +
              "WHERE path = ? ORDER BY seq",
          )
          .all(streamPath);
        return rows.map((row) => {
          if (
            !isRowWith(row, ["path", "seq", "data", "submission_id", "attempt_id"])
          ) {
            throw new StorageError("invalid", {
              message:
                "A flue_conversation_stream_batches row is missing columns.",
            });
          }
          return {
            path: textColumn(row, "path", "flue_conversation_stream_batches"),
            seq: numberColumn(row, "seq", "flue_conversation_stream_batches"),
            data: textColumn(row, "data", "flue_conversation_stream_batches"),
            submissionId: textOrNullColumn(
              row,
              "submission_id",
              "flue_conversation_stream_batches",
            ),
            attemptId: textOrNullColumn(
              row,
              "attempt_id",
              "flue_conversation_stream_batches",
            ),
          };
        });
      },

      listSubmissions(): readonly FlueJournalSubmissionRow[] {
        const rows = handle
          .prepare(
            "SELECT submission_id, kind, status, payload, error, " +
              "accepted_at, settled_at FROM flue_agent_submissions",
          )
          .all();
        return rows.map((row) => {
          if (
            !isRowWith(row, [
              "submission_id",
              "kind",
              "status",
              "payload",
              "error",
              "accepted_at",
              "settled_at",
            ])
          ) {
            throw new StorageError("invalid", {
              message: "A flue_agent_submissions row is missing columns.",
            });
          }
          return {
            submissionId: textColumn(
              row,
              "submission_id",
              "flue_agent_submissions",
            ),
            kind: textColumn(row, "kind", "flue_agent_submissions"),
            status: textColumn(row, "status", "flue_agent_submissions"),
            payload: textOrNullColumn(
              row,
              "payload",
              "flue_agent_submissions",
            ),
            error: textOrNullColumn(row, "error", "flue_agent_submissions"),
            acceptedAt: numberOrNullColumn(
              row,
              "accepted_at",
              "flue_agent_submissions",
            ),
            settledAt: numberOrNullColumn(
              row,
              "settled_at",
              "flue_agent_submissions",
            ),
          };
        });
      },

      close(): void {
        handle.close();
      },
    };

    return reader;
  } catch (error) {
    handle.close();
    if (error instanceof StorageError) throw error;
    throw storageErrorFrom(error, "internal");
  }
}
