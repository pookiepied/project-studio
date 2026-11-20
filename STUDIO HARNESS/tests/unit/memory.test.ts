import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { memoryContextBlock, MAX_BLOCK_CHARS } from "../../src/memory/context.js";
import { MemoryRelay } from "../../src/memory/relay.js";
import { ftsExpression, MemoryStore, type MemoryItem } from "../../src/memory/store.js";
import { memoryTools, type MemoryTool } from "../../src/memory/tools.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createMemoryRoutes, type MemoryConversationPort } from "../../src/transport/http/routes/memory.js";

/**
 * Studio's memory. What is pinned: scope is two words and the harness, not
 * the model, decides which project a project memory belongs to; a
 * conversation never sees another project's memories; identical saves are
 * not duplicated and similar ones are surfaced; batches answer per entry;
 * the context block keeps its order and its budget and says what it left
 * out; and the model's tools reach all of it only through the routes.
 */

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

let db: StudioDatabase;
let store: MemoryStore;
let clock: number;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  clock = NOW;
  store = new MemoryStore(db, { now: () => clock });
});

afterEach(() => {
  db.close();
});

describe("MemoryStore", () => {
  it("saves, finds by loose words, updates and forgets", () => {
    const saved = store.save({ content: "Prefers pnpm over npm", kind: "preference", scope: "personal", author: "model" });
    expect(saved.existed).toBe(false);
    expect(saved.item.id).toMatch(/^mem_[0-9a-f-]{36}$/);
    expect(saved.item.priority).toBe(2);

    expect(store.list({ query: "PNPM" }).map((item) => item.id)).toEqual([saved.item.id]);
    expect(store.list({ query: "prefer" }).map((item) => item.id)).toEqual([saved.item.id]);
    expect(store.list({ query: "yarn" })).toEqual([]);

    const updated = store.update(saved.item.id, { content: "Prefers pnpm, never yarn", priority: 3 });
    expect(updated.priority).toBe(3);
    expect(store.list({ query: "yarn" }).map((item) => item.id)).toEqual([saved.item.id]);
    // The index follows the update rather than keeping the old words.
    expect(store.list({ query: "npm" })).toEqual([]);

    expect(store.forget(saved.item.id)).toBe(true);
    expect(store.forget(saved.item.id)).toBe(false);
    expect(store.list({ query: "pnpm" })).toEqual([]);
  });

  it("does not save the same words twice in one scope, and surfaces similar ones", () => {
    const first = store.save({ content: "Lives in Auckland.", kind: "fact", scope: "personal", author: "model" });
    const again = store.save({ content: "  lives in   auckland ", kind: "fact", scope: "personal", author: "model" });
    expect(again.existed).toBe(true);
    expect(again.item.id).toBe(first.item.id);
    expect(store.count()).toBe(1);

    const near = store.save({ content: "Moved to Auckland in June", kind: "event", scope: "personal", author: "model" });
    expect(near.existed).toBe(false);
    expect(near.similar.map((item) => item.id)).toEqual([first.item.id]);
  });

  it("refuses a project memory with no project, and never widens it to personal", () => {
    expect(() => store.save({ content: "Uses Tauri", kind: "fact", scope: "project", author: "model" })).toThrow(/not filed under a project/);
    expect(store.count()).toBe(0);
  });

  it("shows a conversation personal memories and only its own project's", () => {
    store.save({ content: "Name is Sam", kind: "fact", scope: "personal", author: "user" });
    store.save({ content: "Alpha uses Postgres", kind: "fact", scope: "project", projectId: "alpha", author: "model" });
    store.save({ content: "Beta uses Postgres", kind: "fact", scope: "project", projectId: "beta", author: "model" });

    const outside = store.list({}).map((item) => item.content);
    expect(outside).toEqual(["Name is Sam"]);
    const inAlpha = store.list({ projectId: "alpha", query: "postgres" }).map((item) => item.content);
    expect(inAlpha).toEqual(["Alpha uses Postgres"]);
    const beta = store.list({ projectId: "beta", query: "beta" })[0];
    expect(beta).toBeDefined();
    if (beta === undefined) return;
    // Another project's memory cannot be edited or forgotten from alpha.
    expect(() => store.update(beta.id, { content: "x" }, { projectId: "alpha" })).toThrow(/no memory/);
    expect(store.forget(beta.id, { projectId: "alpha" })).toBe(false);
    expect(store.list({ everything: true })).toHaveLength(3);
  });

  it("moves a memory between personal and project only with a project", () => {
    const saved = store.save({ content: "Uses tabs", kind: "preference", scope: "personal", author: "model" });
    expect(() => store.update(saved.item.id, { scope: "project", projectId: null })).toThrow(/not filed under a project/);
    const moved = store.update(saved.item.id, { scope: "project", projectId: "alpha" });
    expect(moved.projectId).toBe("alpha");
    const back = store.update(saved.item.id, { scope: "personal" });
    expect(back.projectId).toBeNull();
  });

  it("refuses a memory that is too long instead of cutting it", () => {
    expect(() => store.save({ content: "x".repeat(501), kind: "fact", scope: "personal", author: "model" })).toThrow(/at most 500/);
  });

  it("keeps the profile and the switch", () => {
    expect(store.profile().name).toBe("");
    store.setProfile({ name: "Samira Rahman", preferredName: "Sam" });
    store.setProfile({ replyStyle: "Short answers." });
    expect(store.profile()).toEqual({ name: "Samira Rahman", preferredName: "Sam", about: "", replyStyle: "Short answers." });
    expect(store.settings().enabled).toBe(true);
    expect(store.setSettings({ enabled: false }).enabled).toBe(false);
  });

  it("turns any words into an expression FTS5 accepts", () => {
    expect(ftsExpression('AND "OR" -x NEAR(')).toBe('"and"* OR "or"* OR "near"*');
    expect(ftsExpression("?!")).toBeUndefined();
    const bangla = String.fromCodePoint(0x09a2, 0x09be, 0x0995, 0x09be, 0x20, 0x09b6, 0x09b9, 0x09b0);
    for (const query of ['"', "a*b", "(", "NOT", bangla]) {
      expect(() => store.list({ query })).not.toThrow();
    }
  });
});

function memory(overrides: Partial<MemoryItem>): MemoryItem {
  return {
    id: `mem_${"0".repeat(8)}-0000-4000-8000-${String(Math.random()).slice(2, 14).padEnd(12, "0")}`,
    scope: "personal",
    projectId: null,
    kind: "fact",
    content: "Something",
    tags: [],
    priority: 2,
    author: "model",
    sourceConversationId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("the memory context block", () => {
  const empty = { name: "", preferredName: "", about: "", replyStyle: "" };

  it("says nothing when there is nothing to say", () => {
    expect(memoryContextBlock({ profile: empty, items: [], now: NOW })).toBeUndefined();
  });

  it("orders profile, long-term, recent and project, and leaves old normal memories to search", () => {
    const block = memoryContextBlock({
      profile: { ...empty, preferredName: "Sam", replyStyle: "Short." },
      items: [
        memory({ content: "Old detail", updatedAt: NOW - 90 * DAY }),
        memory({ content: "Recent trip", kind: "event", updatedAt: NOW - DAY }),
        memory({ content: "Hates emoji", priority: 3, updatedAt: NOW - 400 * DAY }),
        memory({ content: "Alpha uses Postgres", scope: "project", projectId: "alpha" }),
        memory({ content: "Beta secret plan", scope: "project", projectId: "beta" }),
      ],
      project: { id: "alpha", name: "Alpha" },
      now: NOW,
    });
    expect(block).toBeDefined();
    if (block === undefined) return;
    const body = block.body;
    const order = ["## Profile", "Call them: Sam", "## Long-term", "Hates emoji", "## Recent", "Recent trip", "## Project: Alpha", "Alpha uses Postgres"];
    const positions = order.map((text) => body.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(body).not.toContain("Old detail");
    expect(body).not.toContain("Beta secret plan");
    expect(block.counts.omitted).toBe(1);
    expect(body).toContain("1 more saved memories");
  });

  it("stays inside its budget and counts what did not fit", () => {
    const items = Array.from({ length: 200 }, (_, index) =>
      memory({ content: `High priority fact number ${String(index)} ${"padding ".repeat(40)}`, priority: 3 }),
    );
    const block = memoryContextBlock({ profile: empty, items, now: NOW });
    expect(block).toBeDefined();
    if (block === undefined) return;
    expect(block.body.length).toBeLessThanOrEqual(MAX_BLOCK_CHARS + 300);
    expect(block.counts.omitted).toBeGreaterThan(150);
  });
});

describe("the memory routes and the model's tools", () => {
  let app: Hono<AdmissionEnv>;
  let session: ReturnType<typeof createAdmissionSession>;
  let tools: readonly MemoryTool[];

  const filing: Record<string, string | null> = { "conv-alpha": "alpha", "conv-loose": null, "conv-beta": "beta" };
  const projects: Record<string, string> = { alpha: "Alpha", beta: "Beta" };
  const port: MemoryConversationPort = {
    conversationProject: (conversationId) => {
      if (!(conversationId in filing)) return undefined;
      const projectId = filing[conversationId] ?? null;
      return projectId === null ? null : { id: projectId, name: projects[projectId] ?? projectId };
    },
    projectExists: (projectId) => projectId in projects,
  };

  beforeEach(() => {
    session = createAdmissionSession();
    app = new Hono<AdmissionEnv>();
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.route("/api/memory", createMemoryRoutes(store, port));
    const relay = new MemoryRelay(
      { url: "http://harness.test", credential: session.credential },
      (input, init) => Promise.resolve(app.request(String(input), init)),
    );
    tools = memoryTools(() => relay);
  });

  function tool(name: string): MemoryTool {
    const found = tools.find((candidate) => candidate.definition.name === name);
    if (found === undefined) throw new TypeError(`no tool ${name}`);
    return found;
  }

  async function call(name: string, conversationId: string, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const result = await tool(name).run(conversationId, input);
    const first = result.content[0];
    return { text: typeof first?.["text"] === "string" ? first["text"] : "", isError: result.isError === true };
  }

  function request(path: string, init: RequestInit = {}): Promise<Response> {
    return Promise.resolve(
      app.request(`http://harness.test${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${session.credential}`, "content-type": "application/json" },
      }),
    );
  }

  it("requires the project scope", async () => {
    const limited = createAdmissionSession({ scopes: [ADMISSION_SCOPES.PROVIDER_MANAGEMENT] });
    const scoped = new Hono<AdmissionEnv>();
    scoped.use("*", createAdmissionMiddleware(limited.verifier));
    scoped.route("/api/memory", createMemoryRoutes(store, port));
    const response = await scoped.request("http://harness.test/api/memory/items", {
      headers: { authorization: `Bearer ${limited.credential}` },
    });
    expect(response.status).toBe(403);
  });

  it("files a project memory under the conversation's project, whatever the body says", async () => {
    const response = await request("/api/memory/conversations/conv-alpha/items", {
      method: "POST",
      body: JSON.stringify({ items: [{ content: "Uses Vite", kind: "fact", scope: "project", projectId: "beta" }] }),
    });
    expect(response.status).toBe(200);
    const saved = store.list({ everything: true });
    expect(saved.map((item) => [item.scope, item.projectId, item.author, item.sourceConversationId])).toEqual([
      ["project", "alpha", "model", "conv-alpha"],
    ]);
  });

  it("saves a batch entry by entry and keeps the good ones", async () => {
    const { text, isError } = await call("studio_memory_save", "conv-loose", {
      memories: [
        { content: "Prefers metric units", kind: "preference" },
        { content: "Uses Rust here", kind: "fact", scope: "project" },
        { content: "Name is Sam", kind: "fact", priority: "high" },
      ],
    });
    expect(isError).toBe(false);
    expect(text).toContain("2 of 3 saved");
    expect(text).toMatch(/2\. Not saved: .*not filed under a project/);
    const kept = store.list({ everything: true });
    expect(kept.map((item) => item.content).sort()).toEqual(["Name is Sam", "Prefers metric units"]);
    expect(kept.find((item) => item.content === "Name is Sam")?.priority).toBe(3);
  });

  it("marks a batch that changed nothing as an error", async () => {
    const { isError } = await call("studio_memory_forget", "conv-loose", { ids: ["mem_missing"] });
    expect(isError).toBe(true);
  });

  it("searches, updates and forgets in batches without reaching another project", async () => {
    await call("studio_memory_save", "conv-alpha", {
      memories: [
        { content: "Alpha deploys on Fridays", kind: "fact", scope: "project" },
        { content: "Likes dark themes", kind: "preference" },
      ],
    });
    await call("studio_memory_save", "conv-beta", { memories: [{ content: "Beta deploys on Mondays", kind: "fact", scope: "project" }] });

    const fromAlpha = await call("studio_memory_search", "conv-alpha", { query: "deploys" });
    expect(fromAlpha.text).toContain("Alpha deploys on Fridays");
    expect(fromAlpha.text).not.toContain("Beta");

    const all = store.list({ everything: true });
    const alpha = all.find((item) => item.content.startsWith("Alpha"));
    const beta = all.find((item) => item.content.startsWith("Beta"));
    const dark = all.find((item) => item.content.startsWith("Likes"));
    if (alpha === undefined || beta === undefined || dark === undefined) throw new TypeError("seed missing");

    const updated = await call("studio_memory_update", "conv-alpha", {
      changes: [
        { id: alpha.id, content: "Alpha deploys on Thursdays" },
        { id: dark.id, priority: "high", tags: ["Theme"] },
        { id: beta.id, content: "hijacked" },
      ],
    });
    expect(updated.text).toContain("2 of 3 updated");
    expect(store.get(beta.id)?.content).toBe("Beta deploys on Mondays");
    expect(store.get(dark.id)?.tags).toEqual(["theme"]);

    const forgotten = await call("studio_memory_forget", "conv-alpha", { ids: [alpha.id, beta.id] });
    expect(forgotten.text).toContain("1 of 2 forgotten");
    expect(store.get(alpha.id)).toBeUndefined();
    expect(store.get(beta.id)).toBeDefined();
  });

  it("refuses calls from no known conversation", async () => {
    await expect(call("studio_memory_search", "shared", {})).rejects.toThrow(/inside a Studio conversation/);
  });

  it("reads and updates the profile", async () => {
    const read = await call("studio_memory_profile", "conv-loose", {});
    expect(read.text).toContain("preferredName: (empty)");
    const written = await call("studio_memory_profile", "conv-loose", { preferredName: "Sam" });
    expect(written.text).toContain("preferredName: Sam");
    expect(store.profile().preferredName).toBe("Sam");
  });

  it("lets the person add to a named project, edit and batch-delete from Settings", async () => {
    const added = await request("/api/memory/items", {
      method: "POST",
      body: JSON.stringify({
        items: [
          { content: "Alpha is a monorepo", kind: "fact", scope: "project", projectId: "alpha" },
          { content: "Gamma thing", kind: "fact", scope: "project", projectId: "gamma" },
          { content: "Drinks tea", kind: "fact" },
        ],
      }),
    });
    const { results } = (await added.json()) as { results: { ok: boolean; item?: { id: string } }[] };
    expect(results.map((result) => result.ok)).toEqual([true, false, true]);
    const ids = results.flatMap((result) => (result.item === undefined ? [] : [result.item.id]));
    expect(store.list({ everything: true }).every((item) => item.author === "user")).toBe(true);

    const listed = (await (await request("/api/memory/items")).json()) as { items: unknown[]; total: number };
    expect(listed.total).toBe(2);

    const removed = await request("/api/memory/items/forget", { method: "POST", body: JSON.stringify({ ids }) });
    expect(removed.status).toBe(200);
    expect(store.count()).toBe(0);
  });
});
