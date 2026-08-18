import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type ProviderConnectionDraft,
} from "../../src/contracts/providers.js";
import { ProviderConfigurationError } from "../../src/contracts/models.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { ConnectionStore } from "../../src/providers/connection-store.js";
import { ModelCatalog } from "../../src/providers/model-catalog.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

const OPENAI: ProviderConnectionDraft = {
  id: "openai",
  displayName: "OpenAI",
  kind: "language",
  source: "local",
  baseUrl: "https://api.openai.com/v1",
  enabled: true,
  protocol: "openai-responses",
};

const MEDIA: ProviderConnectionDraft = {
  id: "images",
  displayName: "Images",
  kind: "media",
  source: "local",
  baseUrl: "https://images.example.test/v1",
  enabled: true,
  protocol: "openai-images",
};

let db: StudioDatabase;
let connections: ConnectionStore;
let catalog: ModelCatalog;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  connections = new ConnectionStore({
    db,
    credentials: new InMemoryCredentialStore(),
  });
  catalog = new ModelCatalog({ db, connections });
});

afterEach(() => {
  db.close();
});

describe("provider model catalog", () => {
  it("maps a known provider's live catalog with capabilities and pricing", async () => {
    await connections.add(OPENAI);

    const models = await catalog.listModels({ connectionId: "openai" });

    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.origin === "catalog")).toBe(true);
    expect(models[0]?.capability).toMatchObject({
      textGeneration: "supported",
      toolCalling: "unknown",
    });
    expect(models[0]?.pricing).toEqual({
      input: expect.any(Number),
      output: expect.any(Number),
      cacheRead: expect.any(Number),
      cacheWrite: expect.any(Number),
    });
  });

  it("adds, lists, and deletes a manual model", async () => {
    await connections.add(OPENAI);

    const added = await catalog.setOverride("openai", "typed-model", {
      displayName: "Typed Model",
    });
    expect(added).toMatchObject({
      connectionId: "openai",
      modelId: "typed-model",
      displayName: "Typed Model",
      origin: "manual",
    });
    expect(
      (await catalog.listModels({ connectionId: "openai" })).find(
        (model) => model.modelId === "typed-model",
      ),
    ).toEqual(added);

    await catalog.removeModel("openai", "typed-model");

    expect(
      (await catalog.listModels({ connectionId: "openai" })).find(
        (model) => model.modelId === "typed-model",
      ),
    ).toBeUndefined();
  });

  it("keeps a catalog rename as an override instead of copying the model", async () => {
    await connections.add(OPENAI);
    const original = (await catalog.listModels({ connectionId: "openai" }))[0];
    if (original === undefined) {
      throw new ProviderConfigurationError("The builtin test catalog is empty.");
    }

    const renamed = await catalog.setOverride("openai", original.modelId, {
      displayName: "User Name",
    });

    expect(renamed.displayName).toBe("User Name");
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM provider_model_manual WHERE connection_id = ? AND model_id = ?",
        )
        .get("openai", original.modelId),
    ).toEqual({ count: 0 });
    expect(
      (await catalog.listModels({ connectionId: "openai" })).find(
        (model) => model.modelId === original.modelId,
      )?.displayName,
    ).toBe("User Name");
  });

  it("hides a catalog model without removing it from the list", async () => {
    await connections.add(OPENAI);
    const original = (await catalog.listModels({ connectionId: "openai" }))[0];
    if (original === undefined) {
      throw new ProviderConfigurationError("The builtin test catalog is empty.");
    }

    await catalog.removeModel("openai", original.modelId);

    const hidden = (await catalog.listModels({ connectionId: "openai" })).find(
      (model) => model.modelId === original.modelId,
    );
    expect(hidden).toMatchObject({ origin: "catalog", hidden: true });
  });

  it("rejects unsupported default slots but accepts unknown capability state", async () => {
    await connections.add(OPENAI);
    const catalogModels = await catalog.listModels({ connectionId: "openai" });
    const unsupported = catalogModels.find(
      (model) => model.capability.transcription === "unsupported",
    );
    if (unsupported === undefined) {
      throw new ProviderConfigurationError("No unsupported catalog capability found.");
    }

    await expect(
      catalog.setDefault("transcription", {
        connectionId: "openai",
        modelId: unsupported.modelId,
      }),
    ).rejects.toThrow(ProviderConfigurationError);

    await catalog.setOverride("openai", "unknown-model", {});
    await catalog.setDefault("transcription", {
      connectionId: "openai",
      modelId: "unknown-model",
    });

    expect((await catalog.getDefaults()).transcription).toEqual({
      connectionId: "openai",
      modelId: "unknown-model",
    });
  });

  it("returns a vanished default as absent and keeps its row", async () => {
    await connections.add(OPENAI);
    await catalog.setOverride("openai", "vanished-model", {});
    await catalog.setDefault("textGeneration", {
      connectionId: "openai",
      modelId: "vanished-model",
    });

    await catalog.removeModel("openai", "vanished-model");

    expect((await catalog.getDefaults()).textGeneration).toBeUndefined();
    expect(
      db
        .prepare(
          "SELECT connection_id, model_id FROM provider_default WHERE slot = ?",
        )
        .get("textGeneration"),
    ).toEqual({
      connection_id: "openai",
      model_id: "vanished-model",
    });
  });

  it("returns no models for a media connection", async () => {
    await connections.add(MEDIA);

    expect(await catalog.listModels({ connectionId: "images" })).toEqual([]);
  });
});
