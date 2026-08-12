import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { databasePath, resolveConfigured } from "../platform/paths.js";
import { StorageError, storageErrorFrom } from "./errors.js";
import { LATEST_SCHEMA_VERSION, migrate } from "./migrations.js";

/**
 * The application-owned database.
 *
 * Flue owns `flue.db` — the canonical transcript, the submission journal, and
 * run state — through an opaque persistence adapter with no exposed handle.
 * This is a separate file for everything the *product* owns: provider settings
 * now, and the registries, permission records, and project metadata that later
 * phases add. Keeping them apart means a Flue upgrade cannot collide with our
 * migrations, and our schema version means only our own thing.
 *
 * What never goes in here: secrets. Provider keys and session tokens live in
 * the OS keychain (ADR 0007). A row may reference a credential; it may not
 * contain one, and `assertNoSecretColumns` fails the migration if a column name
 * suggests otherwise.
 *
 * The driver is `node:sqlite`, which Flue already uses — same engine, no new
 * dependency.
 */

const BUSY_TIMEOUT_MS = 5_000;

export interface StudioDatabase {
  readonly handle: DatabaseSync;
  readonly path: string;
  readonly schemaVersion: number;
  /**
   * Runs `work` in a transaction, committing on return and rolling back on
   * throw. Not reentrant: SQLite has no nested transactions, and pretending
   * otherwise would make an inner rollback silently discard outer writes.
   */
  transaction<T>(work: () => T): T;
  close(): void;
}

export interface OpenDatabaseOptions {
  /** Defaults to `PROJECT_STUDIO_STORE_PATH`, then `~/.studio/studio.db`. */
  readonly path?: string;
}

/**
 * Where the database file lives.
 *
 * In the user's Studio home, never relative to the working directory. The
 * harness runs with the user's project as its working directory, so a relative
 * default would create our database inside whatever repository happened to be
 * open — visible in their `git status`, duplicated per project, and lost when
 * they switch.
 */
export function resolveDatabasePath(options: OpenDatabaseOptions = {}): string {
  const configured = options.path ?? process.env.PROJECT_STUDIO_STORE_PATH;

  if (configured === undefined || configured.trim() === "") return databasePath();
  // Callers and tests use `:memory:` for a database with no file at all.
  if (configured === ":memory:") return configured;

  return resolveConfigured(configured);
}

export function openDatabase(options: OpenDatabaseOptions = {}): StudioDatabase {
  const path = resolveDatabasePath(options);

  let handle: DatabaseSync;
  try {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    handle = new DatabaseSync(path);
  } catch (error) {
    // The path is named because "could not be opened" with no location is
    // undiagnosable, and a database path is configuration, not a secret.
    throw new StorageError("unavailable", {
      message: `The Project Studio database at ${path} could not be opened.`,
      cause: error,
    });
  }

  try {
    // WAL keeps a reader from blocking the agent loop's writer. The busy
    // timeout matters because the CLIs open the same file as a running harness.
    if (path !== ":memory:") {
      handle.exec("PRAGMA journal_mode = WAL");
    }
    handle.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    handle.exec("PRAGMA foreign_keys = ON");
    handle.exec("PRAGMA synchronous = NORMAL");
  } catch (error) {
    handle.close();
    throw storageErrorFrom(error, "unavailable");
  }

  let schemaVersion: number;
  try {
    schemaVersion = migrate(handle);
  } catch (error) {
    handle.close();
    throw error instanceof StorageError ? error : storageErrorFrom(error, "migration");
  }

  let depth = 0;

  return {
    handle,
    path,
    schemaVersion,

    transaction<T>(work: () => T): T {
      if (depth > 0) {
        throw new StorageError("internal", {
          message: "Nested database transactions are not supported.",
        });
      }

      depth += 1;
      handle.exec("BEGIN");
      try {
        const result = work();
        handle.exec("COMMIT");
        return result;
      } catch (error) {
        handle.exec("ROLLBACK");
        throw error instanceof StorageError ? error : storageErrorFrom(error);
      } finally {
        depth -= 1;
      }
    },

    close(): void {
      handle.close();
    },
  };
}

let shared: StudioDatabase | undefined;

/**
 * The process-wide database. One connection, opened on first use, migrated
 * once. Tests open their own with `openDatabase` instead of touching this.
 */
export function getDatabase(): StudioDatabase {
  shared ??= openDatabase();
  return shared;
}

export function closeDatabase(): void {
  shared?.close();
  shared = undefined;
}

export { LATEST_SCHEMA_VERSION };
