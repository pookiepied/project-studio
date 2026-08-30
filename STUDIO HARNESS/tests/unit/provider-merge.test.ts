import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";

import { MIGRATIONS, migrate } from "../../src/storage/migrations.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { ConnectionStore } from "../../src/providers/connection-store.js";
import { ModelCatalog } from "../../src/providers/model-catalog.js";
import { readStoredConnections } from "../../src/providers/connection-store.js";
import { createProviderBootstrapCoordinator } from "../../src/models/bootstrap.js";

let db: StudioDatabase;
let credentials: InMemoryCredentialStore;
let connections: ConnectionStore;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  credentials = new InMemoryCredentialStore();
  connections = new ConnectionStore({ db, credentials });
});

afterEach(() => {
  db.close();
});

/** Writes a credential in the Pi bridge's own chunked format, as old builds did. */
function writeLegacyPiCredential(
  store: InMemoryCredentialStore,
  providerId: string,
  apiKey: string,
): void {
  void store.set(
    { scope: "provider", id: providerId },
    `v1:1:${JSON.stringify({ type: "api_key", key: apiKey })}`,
  );
}

describe("the credential seam", () => {
  it("resolves a connection's own key ahead of the vendor's legacy entry", async () => {
    writeLegacyPiCredential(credentials, "openrouter", "sk-or-legacy");
    await connections.add({
      id: "work-openrouter",
      displayName: "Work OpenRouter",
      kind: "language",
      source: "local",
      enabled: true,
      catalogProvider: "openrouter",
      protocol: "openai-completions",
    });
    expect((await connections.get("work-openrouter"))?.credential).toBe("set");
    await connections.update("work-openrouter", { apiKey: "sk-or-typed" });

    // The user's own word outranks the entry an older build wrote.
    expect(await connections.credentialFor("work-openrouter")).toBe("sk-or-typed");
  });

  it("falls back to the vendor's legacy Pi entry, so a carried connection keeps working", async () => {
    writeLegacyPiCredential(credentials, "openrouter", "sk-or-legacy");
    await connections.add({
      id: "work-openrouter",
      displayName: "Work OpenRouter",
      kind: "language",
      source: "local",
      enabled: true,
      catalogProvider: "openrouter",
      protocol: "openai-completions",
    });

    // Nothing was retyped: the carried connection reads the old key.
    expect((await connections.get("work-openrouter"))?.credential).toBe("set");
    expect(await connections.credentialFor("work-openrouter")).toBe("sk-or-legacy");
  });

  it("reads a self-hosted connection's legacy entry under its own id", async () => {
    writeLegacyPiCredential(credentials, "homelab", "sk-homelab");
    await connections.add({
      id: "homelab",
      displayName: "Homelab",
      kind: "language",
      source: "local",
      baseUrl: "http://127.0.0.1:8080/v1",
      enabled: true,
      protocol: "openai-completions",
    });

    expect(await connections.credentialFor("homelab")).toBe("sk-homelab");
  });

  it("reports absent rather than inventing a credential", async () => {
    await connections.add({
      id: "fresh",
      displayName: "Fresh",
      kind: "language",
      source: "local",
      baseUrl: "https://api.example.com/v1",
      enabled: true,
      protocol: "openai-completions",
    });
    expect((await connections.get("fresh"))?.credential).toBe("absent");
    expect(await connections.credentialFor("fresh")).toBeUndefined();
  });

  it("never carries the key in a connection record, in either direction", async () => {
    await connections.add({
      id: "keeper",
      displayName: "Keeper",
      kind: "language",
      source: "local",
      baseUrl: "https://api.example.com/v1",
      enabled: true,
      protocol: "openai-completions",
      apiKey: "sk-never-serialized",
    });

    const row = db
      .prepare(`SELECT record_json FROM provider_connection_record WHERE id = 'keeper'`)
      .get() as Record<string, unknown>;
    expect(String(row.record_json)).not.toContain("sk-never-serialized");
    expect(JSON.stringify(await connections.list())).not.toContain("sk-never-serialized");
  });
});

describe("the sync merged reader", () => {
  it("reads stored connections without touching the credential store", async () => {
    await connections.add({
      id: "reader",
      displayName: "Reader",
      kind: "language",
      source: "local",
      baseUrl: "https://api.example.com/v1",
      enabled: true,
      catalogProvider: "openai",
      protocol: "openai-completions",
      apiKey: "sk-sync-read",
    });

    const rows = readStoredConnections(db);
    const match = rows.find((row) => row.connection.id === "reader");
    expect(match).toBeDefined();
    expect(match?.connection.catalogProvider).toBe("openai");
    // The record parse never resolves status, so nothing here waits on the
    // keychain - and the placeholder status must not be mistaken for truth.
    expect(match?.connection.credential).toBe("absent");
  });
});

describe("manual models and selection", () => {
  async function connectionWithManualModel(): Promise<void> {
    await connections.add({
      id: "conn",
      displayName: "Conn",
      kind: "language",
      source: "local",
      baseUrl: "https://api.example.com/v1",
      enabled: true,
      protocol: "openai-completions",
    });
    await connections.update("conn", { apiKey: "sk-conn" });
  }

  it("adds a hand-entered model with explicit capabilities and its own reasoning levels", async () => {
    await connectionWithManualModel();
    const catalog = new ModelCatalog({ db, connections });

    const created = await catalog.addManualModel("conn", {
      modelId: "reasoner-1",
      displayName: "Reasoner One",
      capability: { reasoning: "supported", vision: "supported" },
      reasoningLevels: ["low", "medium", "high"],
    });

    expect(created.reasoningLevels).toEqual(["low", "medium", "high"]);
    expect(created.capability.reasoning).toBe("supported");
    // Unstated fields stay unknown, never invented.
    expect(created.capability.toolCalling).toBe("unknown");

    const listed = await catalog.listModels({ connectionId: "conn" });
    expect(listed.map((model) => model.modelId)).toEqual(["reasoner-1"]);
  });

  it("applies a selection as the exact complement of hiding", async () => {
    await connectionWithManualModel();
    const catalog = new ModelCatalog({ db, connections });
    await catalog.addManualModel("conn", { modelId: "a", displayName: "A" });
    await catalog.addManualModel("conn", { modelId: "b", displayName: "B" });

    await catalog.setModelSelection("conn", ["b"]);
    const listed = await catalog.listModels({ connectionId: "conn" });
    const byId = new Map(listed.map((model) => [model.modelId, model]));
    expect(byId.get("a")?.hidden).toBe(true);
    expect(byId.get("b")?.hidden).toBe(false);
  });
});

describe("probe-learned availability", () => {
  it("marks what the provider's own list omits and refuses such a default", async () => {
    await connections.add({
      id: "openrouter",
      displayName: "OpenRouter",
      kind: "language",
      source: "local",
      enabled: true,
      catalogProvider: "openrouter",
      protocol: "openai-completions",
    });
    const catalog = new ModelCatalog({ db, connections });

    // The set a live probe of the user's vendor returned: real ids only.
    catalog.recordServedModels("openrouter", ["openai/gpt-5.2", "anthropic/claude-sonnet-4.5"]);
    const listed = await catalog.listModels({ connectionId: "openrouter" });
    const jamba = listed.find((model) => model.modelId === "ai21/jamba-large-1.7");
    const gpt = listed.find((model) => model.modelId === "openai/gpt-5.2");
    expect(jamba?.available).toBe(false);
    expect(gpt?.available).toBe(true);

    await expect(
      catalog.setDefault("textGeneration", { connectionId: "openrouter", modelId: "ai21/jamba-large-1.7" }),
    ).rejects.toThrow(/not offered by its provider/i);
    await expect(
      catalog.setDefault("textGeneration", { connectionId: "openrouter", modelId: "openai/gpt-5.2" }),
    ).resolves.toBeUndefined();
  });

  it("marks nothing when the connection has never been probed", async () => {
    await connections.add({
      id: "openrouter",
      displayName: "OpenRouter",
      kind: "language",
      source: "local",
      enabled: true,
      catalogProvider: "openrouter",
      protocol: "openai-completions",
    });
    const catalog = new ModelCatalog({ db, connections });
    const listed = await catalog.listModels({ connectionId: "openrouter" });
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((model) => model.available)).toBe(true);
  });
});

describe("migration 16 carries the old store forward", () => {
  // A raw handle under the StudioDatabase surface: openDatabase() migrates to
  // the latest version on open, which is exactly what this fixture must not
  // do, and migrate() needs the connection itself.
  function databaseAtVersion15(): { db: StudioDatabase; handle: DatabaseSync } {
    const handle = new DatabaseSync(":memory:");
    handle.exec("PRAGMA foreign_keys = ON");
    migrate(handle, MIGRATIONS.slice(0, 15));
    return { db: asStudioDatabase(handle, 15), handle };
  }

  function asStudioDatabase(handle: DatabaseSync, schemaVersion: number): StudioDatabase {
    return {
      path: ":memory:",
      schemaVersion,
      prepare: (sql) => handle.prepare(sql),
      exec: (sql) => handle.exec(sql),
      transaction<T>(work: () => T): T {
        handle.exec("BEGIN");
        try {
          const result = work();
          handle.exec("COMMIT");
          return result;
        } catch (error) {
          handle.exec("ROLLBACK");
          throw error;
        }
      },
      close: () => handle.close(),
    };
  }

  it("carries custom providers, built-in connections, and the default model", () => {
    const fixture = databaseAtVersion15();
    const legacy = fixture.handle;

    // What the runtime world had written before the merge - the shape of the
    // user's real database on this machine.
    legacy
      .prepare(
        `INSERT INTO custom_provider (id, name, base_url, api, models, context_window, max_tokens, created_at, updated_at)
         VALUES ('openrouter-test', 'OpenRouter (test models)', 'https://openrouter.ai/api/v1', 'openai-completions', '[\"stealth/ox-alpha\"]', 128000, 4096, 1, 1)`,
      )
      .run();
    for (const providerId of ["openrouter", "google", "openrouter-test"]) {
      legacy
        .prepare(
          `INSERT INTO provider_connection (provider_id, source, connected_at, updated_at)
           VALUES (?, 'local', 1, 1)`,
        )
        .run(providerId);
    }
    legacy
      .prepare(`INSERT INTO app_setting (key, value, updated_at) VALUES ('local.default_model', ?, 1)`)
      .run(JSON.stringify({ provider: "google", model: "gemini-3.5-flash" }));

    migrate(legacy);

    const db = asStudioDatabase(legacy, 16);
    const rows = readStoredConnections(db);
    const byId = new Map(rows.map((row) => [row.connection.id, row.connection]));
    expect(rows).toHaveLength(3);

    // The custom provider: its own endpoint, its declared model as a manual row.
    const carried = byId.get("openrouter-test");
    expect(carried).toMatchObject({
      kind: "language",
      baseUrl: "https://openrouter.ai/api/v1",
      protocol: "openai-completions",
      enabled: true,
    });
    expect(carried?.catalogProvider).toBeUndefined();

    // The built-in connections draw their vendor's catalog, protocol and all.
    expect(byId.get("openrouter")).toMatchObject({
      catalogProvider: "openrouter",
      protocol: "openai-completions",
      enabled: true,
    });
    expect(byId.get("google")).toMatchObject({
      catalogProvider: "google",
      protocol: "google-generative-ai",
    });

    // The declared model arrived as the user's own manual row, with the
    // provider-level window attached to it.
    const manual = legacy
      .prepare(`SELECT record_json FROM provider_model_manual WHERE connection_id = 'openrouter-test'`)
      .get() as Record<string, unknown>;
    const record = JSON.parse(String(manual.record_json)) as {
      modelId: string;
      capability: { contextWindow: number | "unknown"; maxOutputTokens: number | "unknown" };
    };
    expect(record.modelId).toBe("stealth/ox-alpha");
    expect(record.capability.contextWindow).toBe(128000);
    expect(record.capability.maxOutputTokens).toBe(4096);

    // The stable alias's target: carried as the textGeneration default.
    const defaults = legacy
      .prepare(`SELECT slot, connection_id, model_id FROM provider_default`)
      .all() as readonly Record<string, unknown>[];
    expect(defaults).toEqual([
      { slot: "textGeneration", connection_id: "google", model_id: "gemini-3.5-flash" },
    ]);

    // The old tables remain - append-only - and re-running the migration
    // carries nothing twice. The version is the count, not a literal: every
    // appended migration would otherwise break this assertion without there
    // being anything wrong.
    expect(legacy.prepare("PRAGMA user_version").get()).toEqual({
      user_version: MIGRATIONS.length,
    });
    const before = readStoredConnections(db).length;
    migrate(legacy);
    expect(readStoredConnections(db)).toHaveLength(before);
    db.close();
  });

  it("leaves a default whose provider was never carried to the legacy key", () => {
    const fixture = databaseAtVersion15();
    const legacy = fixture.handle;
    legacy
      .prepare(
        `INSERT INTO provider_connection (provider_id, source, connected_at, updated_at)
         VALUES ('unknown-vendor', 'local', 1, 1)`,
      )
      .run();
    legacy
      .prepare(`INSERT INTO app_setting (key, value, updated_at) VALUES ('local.default_model', ?, 1)`)
      .run(JSON.stringify({ provider: "unknown-vendor", model: "mystery-model" }));

    // The id is not one the installed catalog knows and no custom row
    // describes it, so there is no honest protocol to declare.
    migrate(legacy);
    expect(readStoredConnections(fixture.db)).toHaveLength(0);

    const carried = legacy
      .prepare(`SELECT connection_id FROM provider_default WHERE slot = 'textGeneration'`)
      .get();
    expect(carried).toBeUndefined();
    const kept = legacy
      .prepare(`SELECT value FROM app_setting WHERE key = 'local.default_model'`)
      .get() as Record<string, unknown>;
    expect(String(kept.value)).toContain("unknown-vendor");
    fixture.db.close();
  });
});

describe("the runtime derives from the merged store", () => {
  it("registers a hand-entered model beside its vendor's own catalog", async () => {
    await connections.add({
      id: "openai",
      displayName: "OpenAI",
      kind: "language",
      source: "local",
      enabled: true,
      catalogProvider: "openai",
      protocol: "openai-completions",
    });
    const catalog = new ModelCatalog({ db, connections });
    await catalog.addManualModel("openai", {
      modelId: "my-fine-tune",
      displayName: "My Fine Tune",
      capability: { reasoning: "supported", contextWindow: 64000 },
      reasoningLevels: ["medium", "high"],
    });
    await catalog.setDefault("textGeneration", {
      connectionId: "openai",
      modelId: "my-fine-tune",
    });

    delete process.env.PROJECT_STUDIO_LOCAL_DEFAULT_MODEL;
    const result = createProviderBootstrapCoordinator().bootstrap(
      { source: "local" },
      { database: db },
    );

    expect(result.descriptor.operational).toBe(true);
    // The alias routes to the default the user set; the reference the picker
    // stores names the model through its vendor, and the runtime resolves it.
    const adapter = result.registry;
    expect(adapter.validate({
      source: "local",
      provider: "project-studio",
      model: "openai/my-fine-tune",
    })).toBeUndefined();
  });

  it("keeps serving the catalog's references for a connected vendor", async () => {
    await connections.add({
      id: "openrouter",
      displayName: "OpenRouter",
      kind: "language",
      source: "local",
      enabled: true,
      catalogProvider: "openrouter",
      protocol: "openai-completions",
    });
    const catalog = new ModelCatalog({ db, connections });
    const served = await catalog.servedModelReferences();

    // The vendor's own chat models are served; nothing else is.
    expect(served.has("openrouter/anthropic/claude-sonnet-4.5")).toBe(true);
    expect([...served].every((reference) => reference.startsWith("openrouter/"))).toBe(true);
  });

  it("offers nothing for a connection that is disabled", async () => {
    await connections.add({
      id: "openrouter",
      displayName: "OpenRouter",
      kind: "language",
      source: "local",
      enabled: false,
      catalogProvider: "openrouter",
      protocol: "openai-completions",
    });
    const catalog = new ModelCatalog({ db, connections });
    expect(await catalog.servedModelReferences()).toEqual(new Set());
  });
});

describe("the declared catalog", () => {
  it("serves retrieval models so the web slots can be filled", async () => {
    await connections.add({
      id: "tavily",
      displayName: "Tavily",
      kind: "retrieval",
      source: "local",
      enabled: true,
      catalogProvider: "tavily",
      protocol: "tavily",
    });
    const catalog = new ModelCatalog({ db, connections });
    const listed = await catalog.listModels({ connectionId: "tavily" });

    expect(listed.map((model) => model.modelId).sort()).toEqual([
      "tavily-extract",
      "tavily-search",
    ]);
    const search = listed.find((model) => model.modelId === "tavily-search");
    expect(search?.capability.webSearch).toBe("supported");
    expect(search?.capability.textGeneration).toBe("unsupported");

    // A retrieval default is settable through the same door as every other
    // slot, and the chat runtime serves no reference for it.
    await catalog.setDefault("webSearch", { connectionId: "tavily", modelId: "tavily-search" });
    const defaults = await catalog.getDefaults();
    expect(defaults.webSearch).toEqual({ connectionId: "tavily", modelId: "tavily-search" });
    expect(await catalog.servedModelReferences()).toEqual(new Set());
  });

  it("gives a language connection its vendor's declared extras beside Pi's models", async () => {
    await connections.add({
      id: "openai",
      displayName: "OpenAI",
      kind: "language",
      source: "local",
      enabled: true,
      catalogProvider: "openai",
      protocol: "openai-completions",
    });
    const catalog = new ModelCatalog({ db, connections });
    const listed = await catalog.listModels({ connectionId: "openai" });

    const whisper = listed.find((model) => model.modelId === "whisper-1");
    expect(whisper).toBeDefined();
    expect(whisper?.capability.transcription).toBe("supported");
    // A speech model cannot answer chat, and says so rather than appearing
    // in the composer.
    expect(whisper?.capability.textGeneration).toBe("unsupported");
    expect(listed.some((model) => model.modelId === "gpt-5.2")).toBe(true);

    // Whisper is named by no served reference: nothing can stream it.
    const served = await catalog.servedModelReferences();
    expect(served.has("openai/whisper-1")).toBe(false);
    expect(served.has("openai/gpt-5.2")).toBe(true);
  });

  it("serves the image catalog to a media connection", async () => {
    await connections.add({
      id: "openrouter-images",
      displayName: "OpenRouter Images",
      kind: "media",
      source: "local",
      enabled: true,
      catalogProvider: "openrouter",
      protocol: "openrouter-images",
    });
    const catalog = new ModelCatalog({ db, connections });
    const listed = await catalog.listModels({ connectionId: "openrouter-images" });

    expect(listed.length).toBe(35);
    const flux = listed.find((model) => model.modelId === "black-forest-labs/flux.2-max");
    expect(flux).toBeDefined();
    expect(flux?.capability.imageGeneration).toBe("supported");
    expect(flux?.shape).toBe("sync");
  });
});
