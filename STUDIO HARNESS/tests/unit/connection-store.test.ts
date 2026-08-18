import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type ProviderConnectionDraft,
  type ProviderConnectionPatch,
} from "../../src/contracts/providers.js";
import { ProviderConfigurationError } from "../../src/contracts/models.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import {
  toErrorReport,
  type ErrorReportContext,
  type ErrorReporter,
} from "../../src/observability/error-reporter.js";
import { customProviderEnvVar } from "../../src/models/local/runtime.js";
import {
  ConnectionStore,
} from "../../src/providers/connection-store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

const ENV_PROVIDER_ID = "env-provider";
const ENV_NAME = customProviderEnvVar(ENV_PROVIDER_ID);
const ORIGINAL_ENV = process.env[ENV_NAME];

let root: string;
let db: StudioDatabase;
let credentials: InMemoryCredentialStore;
let store: ConnectionStore;

function draft(
  id = "openai",
  apiKey?: string,
): ProviderConnectionDraft {
  return {
    id,
    displayName: "OpenAI",
    kind: "language",
    source: "test",
    baseUrl: "https://api.example.test/v1",
    enabled: true,
    protocol: "openai-responses",
    ...(apiKey === undefined ? {} : { apiKey }),
  };
}

function reporterFor(reports: unknown[]): ErrorReporter {
  const reporter: ErrorReporter = {
    report(error: unknown, _context?: ErrorReportContext) {
      reports.push(error);
      return toErrorReport(error);
    },
    child(_fields) {
      return reporter;
    },
  };
  return reporter;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-connection-store-"));
  db = openDatabase({ path: join(root, "studio.db") });
  credentials = new InMemoryCredentialStore();
  store = new ConnectionStore({ db, credentials });
  if (ORIGINAL_ENV === undefined) {
    delete process.env[ENV_NAME];
  } else {
    process.env[ENV_NAME] = ORIGINAL_ENV;
  }
});

afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
  if (ORIGINAL_ENV === undefined) {
    delete process.env[ENV_NAME];
  } else {
    process.env[ENV_NAME] = ORIGINAL_ENV;
  }
});

describe("provider connection store", () => {
  it("returns an added connection from list and get", async () => {
    const added = await store.add(draft());

    expect(await store.list()).toEqual([added]);
    expect(await store.get("openai")).toEqual(added);
  });

  it("does not write an API key to the database file", async () => {
    const secret = "sk-never-on-disk";
    await store.add(draft("openai", secret));

    const storedFiles = await Promise.all(
      [join(root, "studio.db"), join(root, "studio.db-wal")].map(
        async (path) => {
          try {
            return (await readFile(path)).toString("utf8");
          } catch {
            return "";
          }
        },
      ),
    );

    expect(storedFiles.join("\n")).not.toContain(secret);
    expect(await credentials.get({ scope: "provider", id: "openai" })).toBe(secret);
  });

  it("derives credential status from the secure store and environment", async () => {
    const withKey = await store.add(draft("with-key", "sk-stored"));
    const withoutKey = await store.add(draft("without-key"));
    process.env[ENV_NAME] = "env-secret";
    const fromEnv = await store.add(draft(ENV_PROVIDER_ID));

    expect(withKey.credential).toBe("set");
    expect(withoutKey.credential).toBe("absent");
    expect(fromEnv.credential).toBe("from-env");
    expect((await store.get("with-key"))?.credential).toBe("set");
  });

  it("rejects a duplicate id instead of overwriting it", async () => {
    await store.add(draft());

    await expect(store.add(draft())).rejects.toThrow(ProviderConfigurationError);
    expect((await store.get("openai"))?.displayName).toBe("OpenAI");
  });

  it("rejects runtime attempts to change id or kind during update", async () => {
    const original = await store.add(draft());

    const kindPatch: ProviderConnectionPatch = { displayName: "Renamed" };
    Reflect.set(kindPatch, "kind", "media");
    await expect(store.update("openai", kindPatch)).rejects.toThrow(
      ProviderConfigurationError,
    );

    const idPatch: ProviderConnectionPatch = { displayName: "Renamed" };
    Reflect.set(idPatch, "id", "other");
    await expect(store.update("openai", idPatch)).rejects.toThrow(
      ProviderConfigurationError,
    );

    expect(await store.get("openai")).toEqual(original);
  });

  it("sets, clears, and reads back a cleared baseUrl as absent", async () => {
    // Every assertion is a read-back through get/list — the round trip is
    // the defect this test exists to prevent, so the return value of update
    // proves nothing on its own.
    await store.add(draft());

    await store.update("openai", { baseUrl: "https://changed.example.test/v1" });
    expect((await store.get("openai"))?.baseUrl).toBe("https://changed.example.test/v1");

    await store.update("openai", { baseUrl: null });
    expect((await store.get("openai"))?.baseUrl).toBeUndefined();
    expect((await store.list()).find((entry) => entry.id === "openai")?.baseUrl).toBeUndefined();
  });

  it("leaves a stored baseUrl alone when the patch does not mention it", async () => {
    await store.add(draft());

    await store.update("openai", { displayName: "Renamed" });

    expect((await store.get("openai"))?.displayName).toBe("Renamed");
    expect((await store.get("openai"))?.baseUrl).toBe("https://api.example.test/v1");
  });

  it("refuses an empty-string baseUrl rather than reading it as a clear", async () => {
    await store.add(draft());

    await expect(store.update("openai", { baseUrl: "" })).rejects.toThrow(
      ProviderConfigurationError,
    );
    // The refused patch changed nothing.
    expect((await store.get("openai"))?.baseUrl).toBe("https://api.example.test/v1");
  });

  it("removes the record and its credential", async () => {
    await store.add(draft("openai", "sk-to-delete"));

    await store.remove("openai");

    expect(await store.get("openai")).toBeUndefined();
    expect(await store.list()).toEqual([]);
    expect(await credentials.get({ scope: "provider", id: "openai" })).toBeNull();
    expect(credentials.size).toBe(0);
  });

  it("skips and reports a corrupt record while listing the others", async () => {
    const reports: unknown[] = [];
    const reportingStore = new ConnectionStore({
      db,
      credentials,
      reporter: reporterFor(reports),
    });
    await reportingStore.add(draft("valid"));

    db
      .prepare(
        `INSERT INTO provider_connection_record (id, record_json, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run("broken", "{not-json", Date.now());

    const listed = await reportingStore.list();

    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe("valid");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toBeInstanceOf(ProviderConfigurationError);
  });
});
