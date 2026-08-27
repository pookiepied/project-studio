import { Hono } from "hono";

import { beforeEach, describe, expect, it } from "vitest";

import { ConversationStore } from "../../src/conversations/store.js";
import { createTurnSettingsMiddleware } from "../../src/transport/http/middleware/turn-settings.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * The turn-settings middleware, against a real conversation store.
 *
 * What is under test is the ORDER it guarantees: a submission's model and
 * reasoning level are settled into the index before the run is admitted,
 * because the run's initializer reads the row and nothing in the submission
 * itself can reach it. Each case is the middleware composed over a downstream
 * that either admits (202) or refuses (400), which is all a Flue app is to
 * this layer.
 */

const MODEL = "openrouter/anthropic/claude-sonnet-4.5";

let db: StudioDatabase;
let store: ConversationStore;
let served: Set<string>;
let downstream: "admits" | "refuses";

function composeApp(): Hono {
  const app = new Hono();
  app.use(
    "*",
    createTurnSettingsMiddleware({
      conversations: store,
      isModelServed: async (modelId) => served.has(modelId),
    }),
  );
  app.post("/agents/studio/:id", (context) =>
    downstream === "admits"
      ? context.json({ submissionId: "sub_1", offset: "-1" }, 202)
      : context.json({ error: "The agent refused this payload." }, 400),
  );
  return app;
}

async function submit(id: string, body: unknown): Promise<Response> {
  return composeApp().request(`http://harness.test/agents/studio/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  store = new ConversationStore(db);
  served = new Set([MODEL, "google/gemini-3.5-flash"]);
  downstream = "admits";
});

describe("the turn settings a submission carries", () => {
  it("creates a first conversation's row at admission, carrying the settings", async () => {
    const response = await submit("cnv_first", {
      message: "What files can you see?",
      modelId: MODEL,
      reasoningLevel: "high",
    });

    expect(response.status).toBe(202);
    const record = store.get("cnv_first");
    expect(record).toBeDefined();
    expect(record?.modelId).toBe(MODEL);
    expect(record?.reasoningLevel).toBe("high");
    // The title still derives from the words, the way the receipt path did.
    expect(record?.title).toBe("What files can you see?");
  });

  it("removes a row it created when the run is refused", async () => {
    downstream = "refuses";
    const response = await submit("cnv_refused", {
      message: "Never admitted",
      modelId: MODEL,
    });

    expect(response.status).toBe(400);
    // A send the harness refuses creates nothing - the invariant Task 33
    // pinned, which this middleware holds by rolling back its own creation.
    expect(store.get("cnv_refused")).toBeUndefined();
    expect(store.count()).toBe(0);
  });

  it("settles an existing conversation's settings before the run", async () => {
    store.record({ id: "cnv_two", firstMessage: "Earlier words" });

    const response = await submit("cnv_two", {
      message: "Now with a model",
      modelId: "google/gemini-3.5-flash",
      reasoningLevel: "default",
    });

    expect(response.status).toBe(202);
    const record = store.get("cnv_two");
    expect(record?.modelId).toBe("google/gemini-3.5-flash");
    // "default" is stored verbatim, never folded into a level.
    expect(record?.reasoningLevel).toBe("default");
    // A patch is not a receipt: recency is not this write's business.
    expect(record?.lastTurnAt).toBe(store.get("cnv_two")?.createdAt);
  });

  it("leaves a conversation's stored settings alone when the submission carries none", async () => {
    store.record({
      id: "cnv_keep",
      firstMessage: "Already settled",
      modelId: MODEL,
      reasoningLevel: "max",
    });

    const response = await submit("cnv_keep", { message: "Plain turn" });

    expect(response.status).toBe(202);
    const record = store.get("cnv_keep");
    expect(record?.modelId).toBe(MODEL);
    expect(record?.reasoningLevel).toBe("max");
  });

  it("refuses settings the contract cannot describe", async () => {
    const response = await submit("cnx_bad", {
      message: "Hello",
      reasoningLevel: "colossal",
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("do not match the contract");
    // Refused before anything was created or patched.
    expect(store.count()).toBe(0);
  });

  it("refuses a model no connection currently serves", async () => {
    const response = await submit("cnv_unserved", {
      message: "Hello",
      modelId: "openrouter/gone/model",
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("No connected provider currently serves");
    expect(store.count()).toBe(0);
  });

  it("passes a submission through untouched when it carries no settings object", async () => {
    const response = await submit("cnv_plain", { message: "Just words" });

    expect(response.status).toBe(202);
    // The middleware created the row itself here (first turn, no settings) -
    // which is the same admission-time creation, minus the settings.
    const record = store.get("cnv_plain");
    expect(record?.modelId).toBeNull();
  });

  it("touches nothing that is not a studio submission", async () => {
    const app = composeApp();
    await app.request("http://harness.test/agents/studio/cnv_x/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(store.count()).toBe(0);
  });
});
