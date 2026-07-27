import type { DatabaseSync } from "node:sqlite";

import { StorageError, storageErrorFrom } from "./errors.js";

/**
 * Schema evolution for the application-owned database.
 *
 * Migrations are append-only and never edited once released: a user's machine
 * may hold a database written by any previously shipped build. Renaming or
 * rewriting an applied migration silently diverges those machines from a fresh
 * install, which is the failure mode this file exists to prevent.
 */
export interface Migration {
  /** Sequential from 1, with no gaps. */
  readonly version: number;
  /** Stable identifier recorded in the database for auditability. */
  readonly name: string;
  readonly up: (db: DatabaseSync) => void;
}

/**
 * `provider_connection` records that a provider is configured and how to reach
 * it. It records no key material: the secret lives in the OS keychain, and this
 * row is the non-secret half that the keychain cannot store or enumerate.
 *
 * `custom_provider` holds user-declared OpenAI-compatible endpoints — the
 * settings replacement for `PROJECT_STUDIO_LOCAL_PROVIDERS`.
 *
 * `app_setting` is a narrow key/value table for single-valued product state
 * such as the selected default model. It is deliberately not a general-purpose
 * bag; anything with structure gets its own table.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "provider_settings",
    up(db) {
      db.exec(`
        CREATE TABLE custom_provider (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          base_url     TEXT NOT NULL,
          api          TEXT NOT NULL,
          models       TEXT NOT NULL DEFAULT '[]',
          context_window INTEGER,
          max_tokens     INTEGER,
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE provider_connection (
          provider_id   TEXT PRIMARY KEY,
          source        TEXT NOT NULL,
          connected_at  INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE app_setting (
          key         TEXT PRIMARY KEY,
          value       TEXT NOT NULL,
          updated_at  INTEGER NOT NULL
        ) STRICT;
      `);
    },
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as
    | { user_version?: number }
    | undefined;
  return row?.user_version ?? 0;
}

/**
 * Column names that would mean a secret had been written here. Enforced rather
 * than documented: the keychain/database split is the whole security boundary,
 * and it is one careless column away from being undone.
 *
 * Matched on whole suffixes, not substrings. A substring match reads
 * `max_tokens` as credential storage, and a guard that cries wolf gets deleted.
 * Singular `token` is a credential; plural `tokens` is a count.
 */
const SECRET_COLUMN =
  /^(.*_)?(api[_-]?key|secret|password|passphrase|credential|private[_-]?key|token)$/i;

export function assertNoSecretColumns(db: DatabaseSync): void {
  const columns = db
    .prepare(
      `SELECT m.name AS table_name, i.name AS column_name
         FROM sqlite_master AS m
         JOIN pragma_table_info(m.name) AS i
        WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'`,
    )
    .all() as { table_name: string; column_name: string }[];

  for (const column of columns) {
    if (SECRET_COLUMN.test(column.column_name)) {
      throw new StorageError("migration", {
        message: `Schema column ${column.table_name}.${column.column_name} looks like secret storage. Secrets belong in the OS credential store.`,
      });
    }
  }
}

/**
 * Brings the database up to `LATEST_SCHEMA_VERSION`.
 *
 * Each migration runs in its own transaction, so a failure leaves the file at
 * the last fully applied version rather than half-migrated.
 */
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS,
): number {
  const current = readUserVersion(db);
  const latest = migrations.length;

  // A newer build has already written this file. Downgrades happen on desktop,
  // and running old code against a new schema corrupts data quietly; refusing
  // is the only safe response.
  if (current > latest) {
    throw new StorageError("migration", {
      message: `The database was written by a newer version of Project Studio (schema ${current}, this build supports ${latest}).`,
    });
  }

  if (current === latest) {
    return current;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  INTEGER NOT NULL
    ) STRICT;
  `);

  for (const migration of migrations) {
    if (migration.version <= current) {
      continue;
    }

    db.exec("BEGIN");
    try {
      migration.up(db);
      db.prepare(
        "INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, Date.now());
      // `user_version` cannot be parameterized.
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw storageErrorFrom(error, "migration");
    }
  }

  assertNoSecretColumns(db);
  return latest;
}
