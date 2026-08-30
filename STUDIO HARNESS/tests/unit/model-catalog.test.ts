import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

import {
  type ProviderConnectionDraft,
} from "../../src/contracts/providers.js";
import { ProviderConfigurationError } from "../../src/contracts/models.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import {
  toErrorReport,
  type ErrorReportContext,
  type ErrorReporter,
} from "../../src/observability/error-reporter.js";
import { ConnectionStore } from "../../src/providers/connection-store.js";
import { ModelCatalog } from "../../src/providers/model-catalog.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

// id and catalogProvider are deliberately different: keying the catalog on the
// connection id is the defect Part 2 of the wiring task removes.
const OPENAI: ProviderConnectionDraft = {
  id: "work-openai",
  displayName: "Work OpenAI",
  kind: "language",
  source: "local",
  baseUrl: "https://api.openai.com/v1",
  enabled: true,
  catalogProvider: "openai",
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

    const models = await catalog.listModels({ connectionId: "work-openai" });

    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.origin === "catalog")).toBe(true);
    expect(models.every((model) => model.connectionId === "work-openai")).toBe(true);
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

  it("serves one vendor's catalog to two connections and isolates their overrides", async () => {
    await connections.add(OPENAI);
    await connections.add({
      ...OPENAI,
      id: "personal-openai",
      displayName: "Personal OpenAI",
    });

    const work = await catalog.listModels({ connectionId: "work-openai" });
    const personal = await catalog.listModels({
      connectionId: "personal-openai",
    });

    expect(work.length).toBeGreaterThan(0);
    expect(work.length).toBe(personal.length);
    expect(
      personal.every((model) => model.connectionId === "personal-openai"),
    ).toBe(true);

    const target = work[0];
    if (target === undefined) {
      throw new ProviderConfigurationError("The builtin test catalog is empty.");
    }
    await catalog.setOverride("work-openai", target.modelId, { hidden: true });

    const workAfter = await catalog.listModels({ connectionId: "work-openai" });
    const personalAfter = await catalog.listModels({
      connectionId: "personal-openai",
    });
    expect(
      workAfter.find((model) => model.modelId === target.modelId)?.hidden,
    ).toBe(true);
    expect(
      personalAfter.find((model) => model.modelId === target.modelId)?.hidden,
    ).toBe(false);
  });

  it("serves only manual models when the connection names no catalog provider", async () => {
    const selfHosted: ProviderConnectionDraft = {
      id: "ollama",
      displayName: "Ollama",
      kind: "language",
      source: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      enabled: true,
      protocol: "openai-completions",
    };
    await connections.add(selfHosted);

    expect(await catalog.listModels({ connectionId: "ollama" })).toEqual([]);

    const added = await catalog.addManualModel("ollama", {
      modelId: "llama3",
      displayName: "Llama 3",
    });
    expect(await catalog.listModels({ connectionId: "ollama" })).toEqual([added]);
  });

  it("serves only manual models for a vendor no catalog source knows", async () => {
    // A catalogProvider neither Pi nor the declared catalog has heard of is
    // the normal self-hosted spelling, not a fault: the connection simply
    // has only the models entered by hand.
    const reports: unknown[] = [];
    const reportingCatalog = new ModelCatalog({
      db,
      connections,
      reporter: reporterFor(reports),
    });
    await connections.add(OPENAI);
    await connections.add({
      ...OPENAI,
      id: "vendor-x",
      displayName: "Vendor X",
      catalogProvider: "not-a-real-vendor",
    });

    const models = await reportingCatalog.listModels();

    expect(
      models.filter((model) => model.connectionId === "vendor-x"),
    ).toEqual([]);
    expect(reports).toHaveLength(0);
  });

  it("refuses to create a model through setOverride and writes nothing", async () => {
    await connections.add(OPENAI);

    await expect(
      catalog.setOverride("work-openai", "typo-model", {
        displayName: "Typo Model",
      }),
    ).rejects.toThrow(ProviderConfigurationError);

    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM provider_model_manual WHERE connection_id = ?",
        )
        .get("work-openai"),
    ).toEqual({ count: 0 });
  });

  it("adds a manual model with unknown defaults, never unsupported", async () => {
    await connections.add(OPENAI);

    const added = await catalog.addManualModel("work-openai", {
      modelId: "typed-model",
      displayName: "Typed Model",
      capability: { toolCalling: "supported" },
    });

    expect(added).toMatchObject({
      connectionId: "work-openai",
      modelId: "typed-model",
      displayName: "Typed Model",
      origin: "manual",
      hidden: false,
    });
    expect(added.capability.toolCalling).toBe("supported");
    expect(added.capability.textGeneration).toBe("unknown");
    expect(added.capability.vision).toBe("unknown");
    expect(added.shape).toBe("stream");
    expect(added.pricing).toEqual({
      input: "unknown",
      output: "unknown",
      cacheRead: "unknown",
      cacheWrite: "unknown",
    });

    expect(
      (await catalog.listModels({ connectionId: "work-openai" })).find(
        (model) => model.modelId === "typed-model",
      ),
    ).toEqual(added);

    await catalog.removeModel("work-openai", "typed-model");

    expect(
      (await catalog.listModels({ connectionId: "work-openai" })).find(
        (model) => model.modelId === "typed-model",
      ),
    ).toBeUndefined();
  });

  it("refuses a manual model that collides with a catalog or manual model", async () => {
    await connections.add(OPENAI);
    const catalogModel = (
      await catalog.listModels({ connectionId: "work-openai" })
    )[0];
    if (catalogModel === undefined) {
      throw new ProviderConfigurationError("The builtin test catalog is empty.");
    }
    await catalog.addManualModel("work-openai", {
      modelId: "typed-model",
      displayName: "Typed Model",
    });

    await expect(
      catalog.addManualModel("work-openai", {
        modelId: catalogModel.modelId,
        displayName: "Catalog Collision",
      }),
    ).rejects.toThrow(ProviderConfigurationError);
    await expect(
      catalog.addManualModel("work-openai", {
        modelId: "typed-model",
        displayName: "Manual Collision",
      }),
    ).rejects.toThrow(ProviderConfigurationError);
    await expect(
      catalog.addManualModel("missing-connection", {
        modelId: "anything",
        displayName: "Anything",
      }),
    ).rejects.toThrow(ProviderConfigurationError);
  });

  it("keeps a catalog rename as an override instead of copying the model", async () => {
    await connections.add(OPENAI);
    const original = (await catalog.listModels({ connectionId: "work-openai" }))[0];
    if (original === undefined) {
      throw new ProviderConfigurationError("The builtin test catalog is empty.");
    }

    const renamed = await catalog.setOverride("work-openai", original.modelId, {
      displayName: "User Name",
    });

    expect(renamed.displayName).toBe("User Name");
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM provider_model_manual WHERE connection_id = ? AND model_id = ?",
        )
        .get("work-openai", original.modelId),
    ).toEqual({ count: 0 });
    expect(
      (await catalog.listModels({ connectionId: "work-openai" })).find(
        (model) => model.modelId === original.modelId,
      )?.displayName,
    ).toBe("User Name");
  });

  it("hides a catalog model without removing it from the list", async () => {
    await connections.add(OPENAI);
    const original = (await catalog.listModels({ connectionId: "work-openai" }))[0];
    if (original === undefined) {
      throw new ProviderConfigurationError("The builtin test catalog is empty.");
    }

    await catalog.removeModel("work-openai", original.modelId);

    const hidden = (await catalog.listModels({ connectionId: "work-openai" })).find(
      (model) => model.modelId === original.modelId,
    );
    expect(hidden).toMatchObject({ origin: "catalog", hidden: true });
  });

  it("rejects unsupported default slots but accepts unknown capability state", async () => {
    await connections.add(OPENAI);
    const catalogModels = await catalog.listModels({ connectionId: "work-openai" });
    const unsupported = catalogModels.find(
      (model) => model.capability.transcription === "unsupported",
    );
    if (unsupported === undefined) {
      throw new ProviderConfigurationError("No unsupported catalog capability found.");
    }

    await expect(
      catalog.setDefault("transcription", {
        connectionId: "work-openai",
        modelId: unsupported.modelId,
      }),
    ).rejects.toThrow(ProviderConfigurationError);

    await catalog.addManualModel("work-openai", {
      modelId: "unknown-model",
      displayName: "Unknown Model",
    });
    await catalog.setDefault("transcription", {
      connectionId: "work-openai",
      modelId: "unknown-model",
    });

    expect((await catalog.getDefaults()).transcription).toEqual({
      connectionId: "work-openai",
      modelId: "unknown-model",
    });
  });

  it("returns a vanished default as absent and keeps its row", async () => {
    await connections.add(OPENAI);
    await catalog.addManualModel("work-openai", {
      modelId: "vanished-model",
      displayName: "Vanished Model",
    });
    await catalog.setDefault("textGeneration", {
      connectionId: "work-openai",
      modelId: "vanished-model",
    });

    await catalog.removeModel("work-openai", "vanished-model");

    expect((await catalog.getDefaults()).textGeneration).toBeUndefined();
    expect(
      db
        .prepare(
          "SELECT connection_id, model_id FROM provider_default WHERE slot = ?",
        )
        .get("textGeneration"),
    ).toEqual({
      connection_id: "work-openai",
      model_id: "vanished-model",
    });
  });

  it("returns no models for a media connection", async () => {
    await connections.add(MEDIA);

    expect(await catalog.listModels({ connectionId: "images" })).toEqual([]);
  });

  // Task 38: the reasoning levels a composer may offer are the model's own
  // answer, not a fixed list. Pi derives them from `reasoning` and
  // `thinkingLevelMap`; "off" is the composer's "default" and is never
  // returned as a level.
  it("derives reasoning levels from the model's own record", async () => {
    await connections.add(OPENAI);
    const models = await catalog.listModels({ connectionId: "work-openai" });
    const reasoning = models.filter((model) => model.capability.reasoning === "supported");
    const mute = models.filter((model) => model.capability.reasoning === "unsupported");

    expect(reasoning.length).toBeGreaterThan(0);
    expect(mute.length).toBeGreaterThan(0);

    // A model that cannot reason offers no levels at all, so the control can
    // be absent rather than present and inert.
    expect(mute.every((model) => model.reasoningLevels.length === 0)).toBe(true);

    // Every reasoning model's levels agree with Pi's own supported list for
    // that model, minus "off" - including which models carry xhigh or max.
    const piById = new Map(
      getBuiltinModels("openai").map((model) => [model.id, model]),
    );
    for (const model of reasoning) {
      const pi = piById.get(model.modelId);
      if (pi === undefined) continue;
      const expected = getSupportedThinkingLevels(pi).filter((level) => level !== "off");
      expect(model.reasoningLevels).toEqual(expected);
    }
    expect(reasoning.some((model) => model.reasoningLevels.includes("max"))).toBe(true);
  });

  it("answers the served references a submission's model is settled against", async () => {
    await connections.add(OPENAI);
    const models = await catalog.listModels({ connectionId: "work-openai" });
    const first = models[0];
    if (first === undefined) {
      throw new ProviderConfigurationError("The builtin test catalog is empty.");
    }

    const served = await catalog.servedModelReferences();

    // The reference is the vendor the catalog draws from, not the user's own
    // connection name - the same vocabulary the run resolves.
    expect(served.has(`openai/${first.modelId}`)).toBe(true);
    expect(served.has(`work-openai/${first.modelId}`)).toBe(false);
  });
});
