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
const directories: string[] = [];

function open(): StudioDatabase {
  const db = openDatabase({ path: ":memory:" });
  opened.push(db);
  return db;
}

afterEach(() => {
  while (opened.length > 0) {
    opened.pop()?.close();
  }
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
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

  it("gives an already-installed MCP server no sentence and user provenance", () => {
    // The upgrade case, not the fresh one. A server installed before these
    // columns existed has to come through with values, and they have to be the
    // ones that change nothing: no purpose sentence, because nobody wrote one,
    // and `user` provenance, because ADR 0048 §3 makes discovered the
    // reversible side and an upgrade must not be what moves a server onto the
    // eager one.
    const handle = new DatabaseSync(":memory:");
    const before = MIGRATIONS.filter((entry) => entry.name !== "mcp_server_purpose_and_provenance");
    migrate(handle, before);

    const now = Date.now();
    handle
      .prepare(
        `INSERT INTO mcp_server (id, title, transport, args, env, auth_kind, installed_at, updated_at)
         VALUES (?, ?, ?, '[]', '{}', 'none', ?, ?)`,
      )
      .run("older", "Older", "http", now, now);

    migrate(handle);

    const row = handle
      .prepare("SELECT description, provenance FROM mcp_server WHERE id = ?")
      .get("older") as { description: string; provenance: string };
    expect(row.description).toBe("");
    expect(row.provenance).toBe("user");
    handle.close();
  });

  it("migrates the conversation and project tables with their own foreign keys", () => {
    // Asserted against the database, not the stores: these are properties of
    // schema 14 itself, and the stores are one reader among many.
    const handle = new DatabaseSync(":memory:");
    migrate(handle);
    handle.exec("PRAGMA foreign_keys = ON");

    const now = Date.now();
    handle
      .prepare(
        "INSERT INTO project (id, name, icon, description, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("prj_x", "X", "arc", "", now);
    handle
      .prepare(
        "INSERT INTO project_folder (id, project_id, path, name, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("fold_1", "prj_x", "D:/Work/x", "x", 0, now);

    handle
      .prepare(
        `INSERT INTO conversation (
           id, title, title_manual, project_id, pinned, archived,
           model_id, created_at, last_turn_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("cnv_1", null, 0, "prj_x", 0, 0, null, now, now);

    // Filing under a project that does not exist is refused by SQLite.
    expect(() =>
      handle
        .prepare(
          `INSERT INTO conversation (
             id, title, title_manual, project_id, pinned, archived,
             model_id, created_at, last_turn_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("cnv_bad", null, 0, "ghost", 0, 0, null, now, now),
    ).toThrow();

    // The same folder path twice within one project is refused.
    expect(() =>
      handle
        .prepare(
          "INSERT INTO project_folder (id, project_id, path, name, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("fold_2", "prj_x", "D:/Work/x", "alias", 1, now),
    ).toThrow();

    // Deleting a project cascades its folders and detaches its conversations.
    handle.prepare("DELETE FROM project WHERE id = ?").run("prj_x");
    expect(
      (handle.prepare("SELECT COUNT(*) AS n FROM project_folder").get() as { n: number }).n,
    ).toBe(0);
    const remaining = handle
      .prepare("SELECT project_id FROM conversation WHERE id = 'cnv_1'")
      .get() as { project_id: string | null };
    expect(remaining.project_id).toBeNull();
    handle.close();
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

  it("drops orphaned model rows when migration 13 rebuilds the tables", () => {
    // Asserted against the tables, not the catalog API: this is a test of what
    // the database itself does, and a route through application code would
    // prove nothing about the copy.
    const handle = new DatabaseSync(":memory:");
    migrate(handle, MIGRATIONS.slice(0, 12));

    handle.exec("PRAGMA foreign_keys = OFF");
    const now = Date.now();
    handle
      .prepare(
        "INSERT INTO provider_model_override (connection_id, model_id, display_name, hidden, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("ghost", "m1", null, 0, now);
    handle
      .prepare(
        "INSERT INTO provider_model_manual (connection_id, model_id, record_json, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run("ghost", "m1", "{}", now);
    handle
      .prepare(
        "INSERT INTO provider_default (slot, connection_id, model_id, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run("textGeneration", "ghost", "m1", now);

    migrate(handle);

    const table = (name: string): number =>
      (
        handle.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get() as {
          count: number;
        }
      ).count;
    expect(table("provider_model_override")).toBe(0);
    expect(table("provider_model_manual")).toBe(0);
    expect(table("provider_default")).toBe(0);
    handle.close();
  });

  it("cascades model rows when a connection record is deleted after migration 13", () => {
    const handle = new DatabaseSync(":memory:");
    migrate(handle);
    handle.exec("PRAGMA foreign_keys = ON");

    const now = Date.now();
    handle
      .prepare(
        "INSERT INTO provider_connection_record (id, record_json, updated_at) VALUES (?, ?, ?)",
      )
      .run("work-openai", "{}", now);
    handle
      .prepare(
        "INSERT INTO provider_model_override (connection_id, model_id, display_name, hidden, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("work-openai", "m1", "Renamed", 1, now);
    handle
      .prepare(
        "INSERT INTO provider_model_manual (connection_id, model_id, record_json, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run("work-openai", "m2", "{}", now);
    handle
      .prepare(
        "INSERT INTO provider_default (slot, connection_id, model_id, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run("textGeneration", "work-openai", "m2", now);

    handle
      .prepare("DELETE FROM provider_connection_record WHERE id = ?")
      .run("work-openai");

    const table = (name: string): number =>
      (
        handle.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get() as {
          count: number;
        }
      ).count;
    expect(table("provider_model_override")).toBe(0);
    expect(table("provider_model_manual")).toBe(0);
    expect(table("provider_default")).toBe(0);

    // The constraint, not convention, is what stops a new orphan: an insert
    // naming a connection that does not exist is refused by SQLite itself.
    expect(() =>
      handle
        .prepare(
          "INSERT INTO provider_model_override (connection_id, model_id, display_name, hidden, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("ghost", "m1", null, 0, now),
    ).toThrow();
    handle.close();
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

describe("a corrupt database, and what is not one", () => {
  function scratch(): string {
    const directory = mkdtempSync(join(tmpdir(), "studio-wal-"));
    directories.push(directory);
    return join(directory, "studio.db");
  }

  it("refuses to open a corrupt file when nothing can recover it", () => {
    const path = scratch();
    const seed = new DatabaseSync(path);
    seed.exec("PRAGMA journal_mode = WAL");
    seed.exec("CREATE TABLE t (x INTEGER)");
    // A clean close checkpoints and removes the sidecars, so this leaves the
    // main file alone on disk — the genuine corruption case.
    seed.close();
    writeFileSync(path, "not a SQLite database\n");

    expect(() => openDatabase({ path })).toThrow(StorageError);
  });

  it("recovers from a hot WAL rather than treating it as corruption", () => {
    // The behaviour that made the harness integration test read backwards for
    // months: a `-wal` surviving beside an overwritten main file is not a
    // corrupt database. SQLite replays the log and rebuilds a valid header.
    // That is correct, and it is why a test asserting "corrupt" must remove
    // the sidecars — see `harness.test.ts`.
    const path = scratch();
    const seed = new DatabaseSync(path);
    seed.exec("PRAGMA journal_mode = WAL");
    seed.exec("CREATE TABLE t (x INTEGER)");
    seed.exec("INSERT INTO t VALUES (1)");
    const wal = readFileSync(`${path}-wal`);
    const shm = readFileSync(`${path}-shm`);
    seed.close();

    writeFileSync(path, "not a SQLite database\n");
    writeFileSync(`${path}-wal`, wal);
    writeFileSync(`${path}-shm`, shm);

    const recovered = new DatabaseSync(path);
    const row = recovered.prepare("SELECT COUNT(*) AS n FROM t").get();
    expect(row).toEqual({ n: 1 });
    recovered.close();
  });
});
