import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { ConnectionStore } from "../../src/providers/connection-store.js";
import { ModelCatalog } from "../../src/providers/model-catalog.js";
import {
  CapabilityResolver,
  MergedRetrievalResolver,
} from "../../src/providers/capability-defaults.js";

/**
 * The seam Task 40's MCP servers read: one call names a capability slot and
 * receives the connection, the model, and the credential - or undefined, never
 * a silent substitute.
 */

let db: StudioDatabase;
let credentials: InMemoryCredentialStore;
let connections: ConnectionStore;
let catalog: ModelCatalog;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  credentials = new InMemoryCredentialStore();
  connections = new ConnectionStore({ db, credentials });
  catalog = new ModelCatalog({ db, connections });
});

afterEach(() => {
  db.close();
});

async function connectTavily(): Promise<void> {
  await connections.add({
    id: "tavily",
    displayName: "Tavily",
    kind: "retrieval",
    source: "local",
    enabled: true,
    catalogProvider: "tavily",
    protocol: "tavily",
    apiKey: "sk-tavily-typed",
  });
}

describe("the capability selection seam", () => {
  it("answers which provider and model the user chose, with its credential", async () => {
    await connectTavily();
    await catalog.setDefault("webSearch", { connectionId: "tavily", modelId: "tavily-search" });

    const resolver = new CapabilityResolver({ connections, catalog, credentials });
    const resolution = await resolver.resolve("webSearch");

    expect(resolution).toBeDefined();
    expect(resolution?.connection.protocol).toBe("tavily");
    expect(resolution?.model.modelId).toBe("tavily-search");
    // The credential travels to the invoking process and nowhere else.
    expect(resolution?.credential).toBe("sk-tavily-typed");
  });

  it("resolves undefined for an unset slot, never a fallback", async () => {
    await connectTavily();
    const resolver = new CapabilityResolver({ connections, catalog, credentials });
    expect(await resolver.resolve("webSearch")).toBeUndefined();
    expect(await resolver.resolve("videoGeneration")).toBeUndefined();
  });

  it("resolves undefined when the default's connection has been removed", async () => {
    await connectTavily();
    await catalog.setDefault("webSearch", { connectionId: "tavily", modelId: "tavily-search" });
    await connections.remove("tavily");

    const resolver = new CapabilityResolver({ connections, catalog, credentials });
    expect(await resolver.resolve("webSearch")).toBeUndefined();
  });
});

describe("the retrieval runtime's view of the merged defaults", () => {
  it("names the vendor the webSearch default chose and reads its connection key", async () => {
    await connectTavily();
    await catalog.setDefault("webSearch", { connectionId: "tavily", modelId: "tavily-search" });

    const merged = new MergedRetrievalResolver({ connections, catalog, credentials });
    expect(await merged.selectionFor("search")).toBe("tavily");
    expect(await merged.keyFor("tavily")).toBe("sk-tavily-typed");
  });

  it("falls back to the legacy vendor entry when no merged connection exists", async () => {
    await credentials.set({ scope: "provider", id: "brave" }, "sk-brave-legacy");

    const merged = new MergedRetrievalResolver({ connections, catalog, credentials });
    expect(await merged.selectionFor("search")).toBeUndefined();
    expect(await merged.keyFor("brave")).toBe("sk-brave-legacy");
  });
});
