import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  LATEST_SCHEMA_VERSION,
  openDatabase,
  storageHandle,
  type StudioDatabase,
} from "../../src/storage/database.js";
import { StorageError, storageErrorFrom } from "../../src/storage/errors.js";
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
    expect(migrate(storageHandle(db))).toBe(LATEST_SCHEMA_VERSION);
    expect(migrate(storageHandle(db))).toBe(LATEST_SCHEMA_VERSION);
  });

  it("records every applied migration by name", () => {
    const rows = open()
      .prepare("SELECT version, name FROM schema_migration ORDER BY version")
      .all() as unknown as { version: number; name: string }[];

    expect(rows).toHaveLength(MIGRATIONS.length);
    expect(rows.map((row) => row.name)).toEqual(MIGRATIONS.map((entry) => entry.name));
  });

  it("adds the definition hash when an existing grant schema is upgraded", () => {
    const handle = new DatabaseSync(":memory:");
    migrate(handle, MIGRATIONS.slice(0, 7));

    expect(() => migrate(handle)).not.toThrow();

    const columns = handle
      .prepare("PRAGMA table_info(permission_grant)")
      .all() as unknown as { name: string }[];
    expect(columns.map((column) => column.name)).toContain("definition_hash");
    handle.close();
  });

  it("uses sequential versions with no gaps, so a partial upgrade is unambiguous", () => {
    expect(MIGRATIONS.map((entry) => entry.version)).toEqual(
      MIGRATIONS.map((_, index) => index + 1),
    );
  });

  it("refuses a database written by a newer build instead of corrupting it", () => {
    const db = open();
    db.exec("PRAGMA user_version = 999");

    expect(() => migrate(storageHandle(db))).toThrow(StorageError);
    expect(() => migrate(storageHandle(db))).toThrow(/newer version/i);
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
    db.exec("CREATE TABLE leaky (id TEXT PRIMARY KEY, api_key TEXT) STRICT");

    expect(() => assertNoSecretColumns(storageHandle(db))).toThrow(StorageError);
    expect(() => assertNoSecretColumns(storageHandle(db))).toThrow(/credential store/i);
  });

  it("passes for the shipped schema", () => {
    expect(() => assertNoSecretColumns(storageHandle(open()))).not.toThrow();
  });

  it("catches a secret word anywhere in the name, not only at the end", () => {
    // The old pattern anchored the keyword last, so anything appended escaped,
    // and bare `key` was not a keyword at all.
    const secrets = [
      "api_key",
      "api_key_hash",
      "secret_key",
      "encryption_key",
      "signing_key",
      "private_key_pem",
      "auth_token_value",
      "refresh_token",
      "access_token",
      "client_secret",
      "password",
      "passphrase",
      "credential",
      "apiKey",
      // The measurement excuse belongs to `token` alone, so `secret` still
      // refuses this one.
      "token_secret_count",
    ];

    for (const name of secrets) {
      const db = open();
      db.exec(`CREATE TABLE leaky (id TEXT PRIMARY KEY, ${name} TEXT) STRICT`);
      expect(() => assertNoSecretColumns(storageHandle(db)), name).toThrow(/credential store/i);
    }
  });

  it("still passes counts and the names our own schema uses", () => {
    // A guard that cries wolf gets deleted. Plural `tokens` is a count, and
    // `key` and `capability_key` are columns we ship.
    const benign = [
      "max_tokens",
      "tokens",
      "token_count",
      "total_tokens",
      "key",
      "capability_key",
    ];

    for (const name of benign) {
      const db = open();
      db.exec(`CREATE TABLE fine (id TEXT PRIMARY KEY, ${name} TEXT) STRICT`);
      expect(() => assertNoSecretColumns(storageHandle(db)), name).not.toThrow();
    }
  });

  it("rolls the migration back rather than reporting a column that is already there", () => {
    // Checking after the loop was too late: the migration had committed and
    // bumped user_version, so the column stayed on disk.
    const handle = new DatabaseSync(":memory:");
    const leaky: Migration[] = [
      {
        version: 1,
        name: "leaky",
        up: (db) => db.exec("CREATE TABLE leaky (id TEXT PRIMARY KEY, api_key TEXT) STRICT"),
      },
    ];

    expect(() => migrate(handle, leaky)).toThrow(/credential store/i);

    const row = handle.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBe(0);
    expect(
      handle.prepare("SELECT name FROM sqlite_master WHERE name = 'leaky'").get(),
    ).toBeUndefined();
    handle.close();
  });

  it("still fails on a later open of a database that is already poisoned", () => {
    // The guard used to run only after a migration. Once user_version matched,
    // migrate() returned early and the application started normally, forever.
    const handle = new DatabaseSync(":memory:");
    migrate(handle);
    handle.exec("CREATE TABLE leaky (id TEXT PRIMARY KEY, api_key TEXT) STRICT");

    expect(() => migrate(handle)).toThrow(/credential store/i);
    handle.close();
  });
});

describe("transactions", () => {
  it("rolls back every write when the body throws", () => {
    const db = open();

    expect(() =>
      db.transaction(() => {
        storageHandle(db)
          .prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)")
          .run("a", "1", Date.now());
        throw new Error("no");
      }),
    ).toThrow();

    expect(db.prepare("SELECT COUNT(*) AS n FROM app_setting").get()).toEqual({
      n: 0,
    });
  });

  it("commits on return", () => {
    const db = open();
    const result = db.transaction(() => {
      storageHandle(db)
        .prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)")
        .run("a", "1", Date.now());
      return "done";
    });

    expect(result).toBe("done");
    expect(db.prepare("SELECT COUNT(*) AS n FROM app_setting").get()).toEqual({
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
      storageHandle(db)
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

describe("startup failure containment", () => {
  it("refuses an existing empty database instead of silently initializing it", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-empty-db-"));
    const path = join(directory, "studio.db");
    writeFileSync(path, "", "utf8");

    try {
      expect(() => openDatabase({ path })).toThrow(StorageError);
      expect(readFileSync(path)).toHaveLength(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not rewrite a malformed database file", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-corrupt-db-"));
    const path = join(directory, "studio.db");
    const contents = Buffer.from("not a SQLite database\n", "utf8");
    writeFileSync(path, contents);

    try {
      expect(() => openDatabase({ path })).toThrow(StorageError);
      expect(readFileSync(path)).toEqual(contents);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["SQLITE_FULL", "disk full"],
    ["attempt to write a readonly database", "read-only storage"],
  ])("classifies %s as bounded unavailable storage", (message) => {
    expect(storageErrorFrom(new Error(message), "internal").kind).toBe("unavailable");
  });

  it("rolls back an open transaction after SIGKILL and keeps the database valid", async () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-wal-crash-"));
    const path = join(directory, "studio.db");
    const script = `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.argv[1]);
      db.exec("CREATE TABLE IF NOT EXISTS crash_probe (value TEXT NOT NULL) STRICT");
      db.exec("BEGIN IMMEDIATE");
      db.prepare("INSERT INTO crash_probe (value) VALUES (?)").run("uncommitted");
      process.stdout.write("ready\\n");
      setInterval(() => {}, 1_000);
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, path],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    try {
      await new Promise<void>((resolve, reject) => {
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes("ready")) resolve();
        });
        child.once("error", reject);
        child.stderr.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
      });
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));

      const db = openDatabase({ path });
      try {
        expect(db.prepare("PRAGMA integrity_check").get()).toEqual({
          integrity_check: "ok",
        });
        expect(db.prepare("SELECT COUNT(*) AS count FROM crash_probe").get()).toEqual({
          count: 0,
        });
      } finally {
        db.close();
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns a bounded unavailable error when another writer holds the database lock", async () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-lock-"));
    const path = join(directory, "studio.db");
    const script = `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.argv[1]);
      db.exec("CREATE TABLE IF NOT EXISTS lock_probe (value TEXT NOT NULL) STRICT");
      db.exec("BEGIN EXCLUSIVE");
      process.stdout.write("locked\\n");
      setInterval(() => {}, 1_000);
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, path],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    try {
      await new Promise<void>((resolve, reject) => {
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes("locked")) resolve();
        });
        child.once("error", reject);
      });

      expect(() => openDatabase({ path })).toThrow(StorageError);
      expect(() => openDatabase({ path })).toThrow(/could not be opened|unavailable/i);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) resolve();
        else child.once("exit", () => resolve());
      });
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
