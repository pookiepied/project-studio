import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderConfigurationError } from "../../src/contracts/models.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { LocalProviderService } from "../../src/models/local/provider-service.js";
import { ProviderSettingsStore } from "../../src/models/local/settings-store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { StorageError } from "../../src/storage/errors.js";

const OLLAMA = {
  id: "ollama",
  name: "Ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  models: ["llama3.1:8b"],
};

let db: StudioDatabase;
let settings: ProviderSettingsStore;
let credentials: InMemoryCredentialStore;
let service: LocalProviderService;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  settings = new ProviderSettingsStore(db);
  credentials = new InMemoryCredentialStore();
  service = new LocalProviderService({ settings, credentials });
});

afterEach(() => {
  db.close();
});

describe("provider settings store", () => {
  it("round-trips a custom provider", () => {
    settings.upsertCustomProvider({ ...OLLAMA, api: "openai-completions", contextWindow: 8192, maxTokens: 512 });

    const stored = settings.getCustomProvider("ollama");
    expect(stored).toMatchObject({
      id: "ollama",
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      models: ["llama3.1:8b"],
      contextWindow: 8192,
      maxTokens: 512,
    });
  });

  it("updates rather than duplicating on the same id", () => {
    settings.upsertCustomProvider({ ...OLLAMA, api: "openai-completions", contextWindow: undefined, maxTokens: undefined });
    settings.upsertCustomProvider({
      ...OLLAMA,
      name: "Renamed",
      api: "openai-completions",
      contextWindow: undefined,
      maxTokens: undefined,
    });

    expect(settings.listCustomProviders()).toHaveLength(1);
    expect(settings.getCustomProvider("ollama")?.name).toBe("Renamed");
  });

  it("validates on write, so a stored row can never describe an unbuildable provider", () => {
    expect(() =>
      settings.upsertCustomProvider({
        ...OLLAMA,
        baseUrl: "http://example.com/v1",
        api: "openai-completions",
        contextWindow: undefined,
        maxTokens: undefined,
      }),
    ).toThrow(/https/i);

    expect(() =>
      settings.upsertCustomProvider({
        ...OLLAMA,
        api: "not-a-real-protocol",
        contextWindow: undefined,
        maxTokens: undefined,
      }),
    ).toThrow(/unsupported api/i);
  });

  it("records and clears the default model selection", () => {
    expect(settings.getDefaultModel()).toBeUndefined();

    settings.setDefaultModel({ provider: "ollama", model: "llama3.1:8b" });
    expect(settings.getDefaultModel()).toEqual({
      provider: "ollama",
      model: "llama3.1:8b",
    });

    settings.clearDefaultModel();
    expect(settings.getDefaultModel()).toBeUndefined();
  });

  it("reports a corrupted selection instead of returning a half-read one", () => {
    db
      .prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)")
      .run("local.default_model", "{not json", Date.now());

    expect(() => settings.getDefaultModel()).toThrow(StorageError);
  });

  it("tracks which connections Project Studio owns", () => {
    expect(settings.isConnected("openai")).toBe(false);
    settings.recordConnection("openai");
    expect(settings.isConnected("openai")).toBe(true);
    expect(settings.removeConnection("openai")).toBe(true);
    expect(settings.removeConnection("openai")).toBe(false);
  });
});

describe("provider service contracts", () => {
  it("lists a newly added custom provider alongside the built-ins", async () => {
    service.addCustomProvider(OLLAMA);

    const providers = await service.listProviders();
    const ollama = providers.find((entry) => entry.id === "ollama");

    expect(providers.length).toBeGreaterThan(1);
    expect(ollama).toMatchObject({
      id: "ollama",
      origin: "custom",
      baseUrl: "http://127.0.0.1:11434/v1",
      modelCount: 1,
    });
  });

  it("reports a keyless loopback server as connected but not managed", async () => {
    // Ollama and LM Studio need no credential. Reporting them as unconfigured
    // would hide models that work, and offering a Disconnect button for a
    // credential Project Studio never stored would do nothing.
    service.addCustomProvider(OLLAMA);

    const ollama = (await service.listProviders()).find((entry) => entry.id === "ollama");
    expect(ollama?.connected).toBe(true);
    expect(ollama?.managed).toBe(false);
  });

  it("marks a provider managed once Project Studio stores its key", async () => {
    service.addCustomProvider({ ...OLLAMA, id: "proxy", baseUrl: "https://proxy.example.com/v1" });
    await service.connectWithApiKey("proxy", "sk-user-supplied-key");

    const proxy = (await service.listProviders()).find((entry) => entry.id === "proxy");
    expect(proxy?.connected).toBe(true);
    expect(proxy?.managed).toBe(true);
    expect(proxy?.credentialSource).toBe("stored key");
  });

  it("never returns key material from any listing", async () => {
    service.addCustomProvider({ ...OLLAMA, id: "proxy", baseUrl: "https://proxy.example.com/v1" });
    await service.connectWithApiKey("proxy", "sk-user-supplied-key");

    const listing = JSON.stringify(await service.listProviders());
    expect(listing).not.toContain("sk-user-supplied-key");
  });

  it("records the connection only after the credential is stored", async () => {
    service.addCustomProvider({ ...OLLAMA, id: "proxy", baseUrl: "https://proxy.example.com/v1" });
    expect(settings.isConnected("proxy")).toBe(false);

    await service.connectWithApiKey("proxy", "sk-user-supplied-key");
    expect(settings.isConnected("proxy")).toBe(true);
  });

  it("removes the credential and the record on disconnect", async () => {
    service.addCustomProvider({ ...OLLAMA, id: "proxy", baseUrl: "https://proxy.example.com/v1" });
    await service.connectWithApiKey("proxy", "sk-user-supplied-key");

    await service.disconnect("proxy");

    expect(settings.isConnected("proxy")).toBe(false);
    const proxy = (await service.listProviders()).find((entry) => entry.id === "proxy");
    expect(proxy?.connected).toBe(false);
  });

  it("rejects an unknown provider by name", async () => {
    await expect(service.connectWithApiKey("nope", "key")).rejects.toThrow(
      ProviderConfigurationError,
    );
  });

  it("selects a default model and reads it back", async () => {
    service.addCustomProvider(OLLAMA);

    await service.selectDefaultModel({ provider: "ollama", model: "llama3.1:8b" });
    expect(service.getDefaultModel()).toEqual({
      provider: "ollama",
      model: "llama3.1:8b",
    });
  });

  it("refuses a model the runtime could not build a target for", async () => {
    // Validated with the same lookup the runtime uses, so a selection that
    // would fail at startup is refused at the moment it is made.
    service.addCustomProvider(OLLAMA);

    await expect(
      service.selectDefaultModel({ provider: "ollama", model: "not-installed" }),
    ).rejects.toThrow(/has no model/i);
  });

  it("refuses a provider that is not connected", async () => {
    service.addCustomProvider({ ...OLLAMA, id: "proxy", baseUrl: "https://proxy.example.com/v1" });

    await expect(
      service.selectDefaultModel({ provider: "proxy", model: "llama3.1:8b" }),
    ).rejects.toThrow(/not connected/i);
  });

  it("clears a default model that pointed at a provider being disconnected", async () => {
    service.addCustomProvider({ ...OLLAMA, id: "proxy", baseUrl: "https://proxy.example.com/v1" });
    await service.connectWithApiKey("proxy", "sk-user-supplied-key");
    await service.selectDefaultModel({ provider: "proxy", model: "llama3.1:8b" });

    await service.disconnect("proxy");

    // Leaving it would turn a settings click into a startup failure later.
    expect(service.getDefaultModel()).toBeUndefined();
  });

  it("removes a custom provider and the credential belonging to it", async () => {
    service.addCustomProvider({ ...OLLAMA, id: "proxy", baseUrl: "https://proxy.example.com/v1" });
    await service.connectWithApiKey("proxy", "sk-user-supplied-key");
    expect(credentials.size).toBeGreaterThan(0);

    expect(await service.removeCustomProvider("proxy")).toBe(true);

    const providers = await service.listProviders();
    expect(providers.find((entry) => entry.id === "proxy")).toBeUndefined();
    expect(settings.getCustomProvider("proxy")).toBeUndefined();
  });

  it("reports removing an unknown custom provider rather than pretending", async () => {
    expect(await service.removeCustomProvider("never-existed")).toBe(false);
  });

  it("lists a provider's models with provider-qualified ids", () => {
    service.addCustomProvider(OLLAMA);

    expect(service.listModels("ollama")).toEqual([
      {
        provider: "ollama",
        model: "llama3.1:8b",
        id: "ollama/llama3.1:8b",
        name: "llama3.1:8b",
        contextWindow: undefined,
        maxTokens: undefined,
      },
    ]);
  });
});
