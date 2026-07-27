import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  LATEST_SCHEMA_VERSION,
  openDatabase,
  type StudioDatabase,
} from "../../src/storage/database.js";
import { StorageError } from "../../src/storage/errors.js";
import {
  assertNoSecretColumns,
  migrate,
  MIGRATIONS,
  type Migration,
} from "../../src/storage/migrations.js";

const opened: StudioDatabase[] = [];

function open(): StudioDatabase {
  const db = openDatabase({ path: ":memory:" });
  opened.push(db);
  return db;
}

afterEach(() => {
  while (opened.length > 0) {
    opened.pop()?.close();
  }
});

describe("migrations", () => {
  it("brings a new database to the latest schema version", () => {
    expect(open().schemaVersion).toBe(LATEST_SCHEMA_VERSION);
  });

  it("is idempotent: a second run applies nothing", () => {
    const db = open();
    expect(migrate(db.handle)).toBe(LATEST_SCHEMA_VERSION);
    expect(migrate(db.handle)).toBe(LATEST_SCHEMA_VERSION);
  });

  it("records every applied migration by name", () => {
    const rows = open()
      .handle.prepare("SELECT version, name FROM schema_migration ORDER BY version")
      .all() as unknown as { version: number; name: string }[];

    expect(rows).toHaveLength(MIGRATIONS.length);
    expect(rows.map((row) => row.name)).toEqual(MIGRATIONS.map((entry) => entry.name));
  });

  it("uses sequential versions with no gaps, so a partial upgrade is unambiguous", () => {
    expect(MIGRATIONS.map((entry) => entry.version)).toEqual(
      MIGRATIONS.map((_, index) => index + 1),
    );
  });

  it("refuses a database written by a newer build instead of corrupting it", () => {
    const db = open();
    db.handle.exec("PRAGMA user_version = 999");

    expect(() => migrate(db.handle)).toThrow(StorageError);
    expect(() => migrate(db.handle)).toThrow(/newer version/i);
  });

  it("leaves the schema at the last good version when a migration throws", () => {
    // A raw handle, not `openDatabase`: this needs a genuinely empty database,
    // and reusing a migrated one would collide on `schema_migration`.
    const handle = new DatabaseSync(":memory:");

    const failing: Migration[] = [
      { version: 1, name: "ok", up: (handle) => handle.exec("CREATE TABLE a (id TEXT) STRICT") },
      {
        version: 2,
        name: "broken",
        up: () => {
          throw new Error("migration exploded");
        },
      },
    ];

    expect(() => migrate(handle, failing)).toThrow(StorageError);

    const row = handle.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBe(1);
    // The first migration is intact; the failed one left nothing behind.
    expect(
      handle.prepare("SELECT name FROM sqlite_master WHERE name = 'a'").get(),
    ).toBeDefined();
    handle.close();
  });
});

describe("the keychain/database boundary", () => {
  it("rejects a schema that adds a column looking like secret storage", () => {
    const db = open();
    db.handle.exec("CREATE TABLE leaky (id TEXT PRIMARY KEY, api_key TEXT) STRICT");

    expect(() => assertNoSecretColumns(db.handle)).toThrow(StorageError);
    expect(() => assertNoSecretColumns(db.handle)).toThrow(/credential store/i);
  });

  it("passes for the shipped schema", () => {
    expect(() => assertNoSecretColumns(open().handle)).not.toThrow();
  });
});

describe("transactions", () => {
  it("rolls back every write when the body throws", () => {
    const db = open();

    expect(() =>
      db.transaction(() => {
        db.handle
          .prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)")
          .run("a", "1", Date.now());
        throw new Error("no");
      }),
    ).toThrow();

    expect(db.handle.prepare("SELECT COUNT(*) AS n FROM app_setting").get()).toEqual({
      n: 0,
    });
  });

  it("commits on return", () => {
    const db = open();
    const result = db.transaction(() => {
      db.handle
        .prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)")
        .run("a", "1", Date.now());
      return "done";
    });

    expect(result).toBe("done");
    expect(db.handle.prepare("SELECT COUNT(*) AS n FROM app_setting").get()).toEqual({
      n: 1,
    });
  });

  it("refuses to nest rather than let an inner rollback discard outer writes", () => {
    const db = open();
    expect(() =>
      db.transaction(() => {
        db.transaction(() => undefined);
      }),
    ).toThrow(/Nested/i);
  });

  it("classifies a uniqueness violation as a conflict", () => {
    const db = open();
    const insert = () =>
      db.handle
        .prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)")
        .run("dup", "1", Date.now());

    insert();
    let caught: unknown;
    try {
      db.transaction(insert);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StorageError);
    expect((caught as StorageError).kind).toBe("conflict");
    expect((caught as StorageError).code).toBe("storage.conflict");
  });
});
