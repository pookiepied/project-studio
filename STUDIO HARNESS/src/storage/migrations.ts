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
  {
    version: 2,
    name: "permission_grants",
    up(db) {
      // A grant is scoped to (agent, conversation-or-null, capability). A null
      // conversation is an "always" grant; a set one expires with the
      // conversation. The unique index is what makes a repeated approval an
      // update rather than a pile of duplicates nobody can revoke.
      db.exec(`
        CREATE TABLE permission_grant (
          id              TEXT PRIMARY KEY,
          capability_key  TEXT NOT NULL,
          agent_id        TEXT NOT NULL,
          conversation_id TEXT,
          project_id      TEXT,
          verdict         TEXT NOT NULL,
          granted_at      INTEGER NOT NULL,
          revoked_at      INTEGER
        ) STRICT;

        CREATE UNIQUE INDEX permission_grant_scope
          ON permission_grant (capability_key, agent_id, IFNULL(conversation_id, ''))
          WHERE revoked_at IS NULL;
      `);
    },
  },
  {
    version: 3,
    name: "grant_resource_pattern",
    up(db) {
      // A grant now narrows to what the call touched, so "allow editing under
      // src" is expressible and does not silently become "allow editing
      // anything". A null pattern keeps the old meaning — the whole capability
      // — so grants written before this migration still mean what the user
      // approved.
      //
      // The index is dropped and rebuilt because the uniqueness rule itself
      // changed: the same capability may now be granted twice with different
      // patterns, and the old index would reject the second as a duplicate.
      db.exec(`
        ALTER TABLE permission_grant ADD COLUMN resource_pattern TEXT;

        DROP INDEX permission_grant_scope;

        CREATE UNIQUE INDEX permission_grant_scope
          ON permission_grant (
            capability_key,
            agent_id,
            IFNULL(conversation_id, ''),
            IFNULL(resource_pattern, '')
          )
          WHERE revoked_at IS NULL;
      `);
    },
  },
  {
    version: 4,
    name: "workspace_trust",
    up(db) {
      // Trust is per folder and deliberately not per conversation: opening the
      // same repository again must not re-ask, and trusting it in one
      // conversation must not leave it untrusted in the next.
      //
      // The absence of a row is meaningful — it means "never decided", which is
      // untrusted. So a revoked trust is stored as `trusted = 0` rather than
      // deleted, to keep "declined" distinguishable from "never asked".
      db.exec(`
        CREATE TABLE workspace_trust (
          root        TEXT PRIMARY KEY,
          trusted     INTEGER NOT NULL,
          decided_at  INTEGER NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 5,
    name: "grant_project_scope",
    up(db) {
      // `project_id` was written from the start and never read, so "always allow
      // git:push" approved in one project applied in every other one. The query
      // matches on it now, and the uniqueness rule has to follow: without
      // `project_id` in the index, approving the same thing in a second project
      // collides with the first row and is rejected as a duplicate.
      //
      // No data changes. Existing rows already carry the project they were
      // approved in, so they narrow to it rather than being lost.
      db.exec(`
        DROP INDEX permission_grant_scope;

        CREATE UNIQUE INDEX permission_grant_scope
          ON permission_grant (
            capability_key,
            agent_id,
            IFNULL(conversation_id, ''),
            IFNULL(project_id, ''),
            IFNULL(resource_pattern, '')
          )
          WHERE revoked_at IS NULL;
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
 * Words that mean a column holds a secret.
 *
 * Matched as **whole words**, anywhere in the name, rather than as a suffix.
 * The old pattern anchored the keyword at the end, so anything after it escaped
 * — `api_key_hash` and `private_key_pem` both passed — and bare `key` was not a
 * keyword at all, so `secret_key`, `encryption_key`, and `signing_key` passed
 * too.
 *
 * Singular `token` is a credential; plural `tokens` is a count. That is why
 * `max_tokens` is absent from the list rather than excused by the allowlist
 * below: it never matches in the first place.
 */
const SECRET_WORDS = new Set([
  "secret",
  "password",
  "passphrase",
  "credential",
  "credentials",
  "token",
  "key",
  "apikey",
  "privatekey",
]);

/**
 * Column names that contain a secret word and are still not secrets.
 *
 * Deliberately an allowlist rather than a cleverer pattern. `key` is too common
 * a word to refuse on sight and too dangerous to ignore, so the default is to
 * refuse and each exception is written down once, here, where it can be argued
 * with. A new column named `cache_key` fails the check — and the fix is to add
 * it to this list on purpose, not to weaken the rule for everything.
 */
const NOT_SECRET_COLUMNS = new Set([
  // `app_setting.key` — the key half of a key/value table.
  "key",
  // `permission_grant.capability_key` — a capability identifier, not key material.
  "capability_key",
]);

/**
 * Words that make `token` a measurement rather than a credential.
 *
 * Only `token` needs this. Usage accounting is full of `token_count` and
 * `total_tokens`, and refusing those would be the guard crying wolf. `key`,
 * `secret`, `password`, and the rest never appear in a measurement, so they get
 * no such excuse — and `token_secret` is still refused, because the excuse
 * applies to `token` alone and `secret` is still there.
 */
const MEASUREMENT_WORDS = new Set(["count", "total", "usage", "limit", "max", "used"]);

/**
 * Splits a column name into words on `_`, `-`, and camel-case boundaries.
 *
 * The camel-case case is defence rather than need: our own columns are all
 * snake_case, but the guard must not be defeated by a migration that is not.
 */
function words(columnName: string): string[] {
  return columnName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word !== "");
}

/**
 * Whether a column name means a secret had been written here. Enforced rather
 * than documented: the keychain/database split is the whole security boundary,
 * and it is one careless column away from being undone.
 */
function looksLikeSecret(columnName: string): boolean {
  if (NOT_SECRET_COLUMNS.has(columnName.toLowerCase())) return false;

  const parts = words(columnName);
  const found = parts.filter((word) => SECRET_WORDS.has(word));
  if (found.length === 0) return false;

  const onlyToken = found.every((word) => word === "token");
  if (onlyToken && parts.some((word) => MEASUREMENT_WORDS.has(word))) return false;

  return true;
}

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
    if (looksLikeSecret(column.column_name)) {
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
 *
 * The secret-column guard runs in two places, and both are needed:
 *
 * 1. **Inside each migration's transaction**, so a migration that adds a
 *    credential column rolls back instead of committing. Checking after the
 *    loop was too late — the column and its `user_version` bump were already on
 *    disk, and only the process that ran the migration ever saw the error.
 * 2. **On every open**, before the early return. Otherwise a file poisoned by an
 *    older build passes forever: `current === latest` returns immediately, and
 *    the application starts normally with the column present.
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

  // Every open, not only one that migrates.
  assertNoSecretColumns(db);

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
      // Inside the transaction: a refusal must undo the column, not report it.
      assertNoSecretColumns(db);
      db.prepare(
        "INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, Date.now());
      // `user_version` cannot be parameterized.
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      // Our own refusal already says what is wrong and names the column.
      // `storageErrorFrom` would replace it with the generic schema message,
      // which is the one thing the person reading it cannot act on.
      if (error instanceof StorageError) throw error;
      throw storageErrorFrom(error, "migration");
    }
  }

  return latest;
}
