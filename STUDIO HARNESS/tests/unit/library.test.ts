import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FlueObservation } from "@flue/runtime";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import * as describeModule from "../../src/agents/describe.js";
import { DESCRIBE_PROMPT } from "../../src/context/describe-prompt.js";
import { environmentBlock, environmentFacts } from "../../src/context/environment.js";
import type { ExecutionScope } from "../../src/contracts/capabilities.js";
import { DESCRIBE_AGENT_ID } from "../../src/contracts/agents.js";
import {
  DescribeError,
  ImageDescriber,
  descriptionFromReply,
  type ImageDescriberPort,
} from "../../src/library/describer.js";
import { LibraryStore, kindOfMime, normalizeTags } from "../../src/library/store.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../src/permissions/kernel.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { CallGate } from "../../src/tools/gate.js";
import { registerLibraryTools } from "../../src/tools/library/index.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createLibraryRoutes } from "../../src/transport/http/routes/library.js";

/**
 * The library: the store that keeps files and what was said about them,
 * the tools the model finds and keeps with, the routes the webview uses,
 * and the describer that proposes a picture's label. What is pinned: a
 * kept file lives under its id and survives a re-tag; search matches the
 * person's words and never a face; the subject is never taken from the
 * model; the tool answers with a readable path; the routes refuse what
 * they should.
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let root: string;
let db: StudioDatabase;
let store: LibraryStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "studio-library-"));
  db = openDatabase({ path: ":memory:" });
  store = new LibraryStore(db, { directory: join(root, "library"), now: () => 1_700_000_000_000 });
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("LibraryStore", () => {
  it("keeps a file under its id and what the person said about it", () => {
    const item = store.add({
      fileName: "Me hiking.PNG",
      mimeType: "image/png",
      bytes: PNG,
      title: "Me on the ridge",
      subject: "me",
      tags: ["Hiking", "hiking", " mountain ", ""],
      sourceConversationId: "cnv_1",
    });
    expect(item.id).toMatch(/^lib_/);
    expect(item.kind).toBe("image");
    expect(item.path).toBe(join(root, "library", `${item.id}.png`));
    expect(existsSync(item.path)).toBe(true);
    expect(item.tags).toEqual(["hiking", "mountain"]);
    expect(item.subject).toBe("me");
    expect(item.byteLength).toBe(PNG.byteLength);
    expect(store.get(item.id)).toEqual(item);
  });

  it("falls back to the file name as the title, and refuses an empty file", () => {
    const item = store.add({ fileName: "notes.md", mimeType: "text/markdown", bytes: Buffer.from("# hi") });
    expect(item.title).toBe("notes.md");
    expect(item.kind).toBe("document");
    expect(() => store.add({ fileName: "x", mimeType: "text/plain", bytes: Buffer.alloc(0) })).toThrow(/empty/);
  });

  it("searches the person's words: title, subject, tags, name", () => {
    const me = store.add({ fileName: "a.png", mimeType: "image/png", bytes: PNG, title: "Portrait", subject: "me" });
    const logo = store.add({ fileName: "logo.svg", mimeType: "image/svg+xml", bytes: PNG, title: "Company logo", tags: ["brand"] });
    store.add({ fileName: "contract.pdf", mimeType: "application/pdf", bytes: PNG, title: "Lease" });

    expect(store.list({ subject: "me" }).map((i) => i.id)).toEqual([me.id]);
    expect(store.list({ tag: "brand" }).map((i) => i.id)).toEqual([logo.id]);
    expect(store.list({ query: "logo" }).map((i) => i.id)).toEqual([logo.id]);
    expect(store.list({ kind: "document" })).toHaveLength(1);
    expect(store.list({ query: "100%" })).toHaveLength(0);
    expect(store.list()).toHaveLength(3);
    expect(store.subjects()).toEqual(["me"]);
  });

  it("re-tags without moving the file, and removes file and row together", () => {
    const item = store.add({ fileName: "a.png", mimeType: "image/png", bytes: PNG });
    const updated = store.update(item.id, { title: "Better", subject: "Bruno", tags: ["dog"] });
    expect(updated.path).toBe(item.path);
    expect(updated.title).toBe("Better");
    expect(store.list({ subject: "bruno" })).toHaveLength(1);
    expect(store.remove(item.id)).toBe(true);
    expect(existsSync(item.path)).toBe(false);
    expect(store.remove(item.id)).toBe(false);
    expect(() => store.update(item.id, { title: "x" })).toThrow(/no such/);
  });

  it("files an existing path as a copy", () => {
    const source = join(root, "artifact.png");
    writeFileSync(source, PNG);
    const item = store.addFromPath(source, { mimeType: "image/png", title: "Cover" });
    expect(item.fileName).toBe("artifact.png");
    expect(existsSync(source)).toBe(true);
    expect(existsSync(item.path)).toBe(true);
  });

  it("classifies by mime family and bounds tags", () => {
    expect(kindOfMime("image/webp")).toBe("image");
    expect(kindOfMime("application/pdf")).toBe("document");
    expect(kindOfMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("document");
    expect(kindOfMime("audio/mpeg")).toBe("audio");
    expect(kindOfMime("application/zip")).toBe("other");
    expect(normalizeTags(Array.from({ length: 40 }, (_, index) => `t${String(index)}`))).toHaveLength(24);
  });
});

describe("the library tools", () => {
  const SCOPE: ExecutionScope = { conversationId: "cnv_1", projectId: "proj-1", agentId: "studio" };
  let gate: CallGate;
  let workspace: string;

  beforeEach(() => {
    workspace = join(root, "workspace");
    mkdirSync(workspace, { recursive: true });
    gate = new CallGate({
      kernel: new PermissionKernel({
        grants: new PermissionGrantStore(db),
        approver: { request: async () => ({ verdict: "allow", duration: "once" }) },
      }),
      sandbox: new LocalSandbox(
        createSandboxPolicy({ workspaceRoot: workspace, readRoots: [store.directory] }),
      ),
    });
    registerLibraryTools(gate, store);
  });

  const search = (input: unknown) => gate.call({ name: "native/library_search", input, scope: SCOPE });
  const keep = (input: unknown) => gate.call({ name: "native/library_keep", input, scope: SCOPE });

  it("answers an empty library honestly", async () => {
    const result = (await search({})) as { content: { text: string }[] };
    expect(result.content[0]?.text).toMatch(/library is empty/i);
  });

  it("finds by subject and answers with a readable path", async () => {
    const me = store.add({ fileName: "me.png", mimeType: "image/png", bytes: PNG, subject: "me", tags: ["hiking"] });
    store.add({ fileName: "logo.png", mimeType: "image/png", bytes: PNG, title: "Logo" });
    const result = (await search({ subject: "me" })) as { content: { text: string }[] };
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("1 item match");
    expect(text).toContain(`Path: ${me.path}`);
    expect(text).toContain("Subject: me");
    expect(text).not.toContain("Logo");
    expect(text).toMatch(/use read to look at a picture/);
  });

  it("refuses a kind it does not know and a limit out of range", async () => {
    await expect(search({ kind: "face" })).rejects.toThrow(/kind must be one of/);
    await expect(search({ limit: 0 })).rejects.toThrow(/limit must be/);
  });

  it("keeps a readable file with the conversation as its source", async () => {
    writeFileSync(join(workspace, "cover.png"), PNG);
    const result = (await keep({ path: "cover.png", title: "Cover", subject: "logo", tags: ["brand"] })) as {
      content: { text: string }[];
    };
    expect(result.content[0]?.text).toMatch(/Kept in the library/);
    const [item] = store.list();
    expect(item?.sourceConversationId).toBe("cnv_1");
    expect(item?.subject).toBe("logo");
    expect(item?.mimeType).toBe("image/png");
  });

  it("refuses to keep a path that is not there", async () => {
    await expect(keep({ path: "missing.png" })).rejects.toThrow(/no file at that path/i);
  });
});

describe("the library routes", () => {
  let app: Hono<AdmissionEnv>;
  let session: ReturnType<typeof createAdmissionSession>;

  function compose(describer?: ImageDescriberPort): void {
    session = createAdmissionSession();
    app = new Hono<AdmissionEnv>();
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.route("/api/library", createLibraryRoutes(store, describer === undefined ? {} : { describer }));
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
    scoped.route("/api/library", createLibraryRoutes(store));
    const response = await scoped.request("http://harness.test/api/library", {
      headers: { authorization: `Bearer ${limited.credential}` },
    });
    expect(response.status).toBe(403);
  });

  it("adds, lists, serves, edits and removes an item", async () => {
    compose();
    const added = await request("/api/library", {
      method: "POST",
      body: JSON.stringify({
        fileName: "me.png",
        mimeType: "image/png",
        data: `data:image/png;base64,${PNG.toString("base64")}`,
        subject: "me",
        tags: ["Hiking"],
        sourceConversationId: "cnv_9",
      }),
    });
    expect(added.status).toBe(201);
    const { item } = (await added.json()) as { item: { id: string; tags: string[]; path: string } };
    expect(item.tags).toEqual(["hiking"]);

    const listed = await request("/api/library?subject=me");
    const listing = (await listed.json()) as { items: unknown[]; subjects: string[]; directory: string };
    expect(listing.items).toHaveLength(1);
    expect(listing.subjects).toEqual(["me"]);
    expect(listing.directory).toBe(store.directory);

    const bytes = await request(`/api/library/${item.id}/bytes`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await bytes.arrayBuffer()).equals(PNG)).toBe(true);

    const edited = await request(`/api/library/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({ title: "Ridge", subject: "" }),
    });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { item: { title: string; subject: string } }).item).toMatchObject({
      title: "Ridge",
      subject: "",
    });

    expect((await request(`/api/library/${item.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await request(`/api/library/${item.id}`)).status).toBe(404);
  });

  it("refuses a body it cannot read and an unknown id", async () => {
    compose();
    expect((await request("/api/library", { method: "POST", body: "{" })).status).toBe(400);
    expect((await request("/api/library", { method: "POST", body: JSON.stringify({ fileName: "x" }) })).status).toBe(400);
    expect((await request("/api/library/lib_nope/bytes")).status).toBe(404);
  });

  it("answers a description from the describer, and 502 when the model failed", async () => {
    compose({
      describe: async () => ({ title: "A ridge", description: "A person hiking.", tags: ["hiking"] }),
    });
    const ok = await request("/api/library/describe", {
      method: "POST",
      body: JSON.stringify({ data: PNG.toString("base64"), mimeType: "image/png", hint: "me.png" }),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { description: { title: string } }).description.title).toBe("A ridge");

    compose({
      describe: async () => {
        throw new DescribeError("model-failed", "The model did not answer in time.");
      },
    });
    const failed = await request("/api/library/describe", {
      method: "POST",
      body: JSON.stringify({ data: PNG.toString("base64"), mimeType: "image/png" }),
    });
    expect(failed.status).toBe(502);

    compose();
    const none = await request("/api/library/describe", {
      method: "POST",
      body: JSON.stringify({ data: PNG.toString("base64"), mimeType: "image/png" }),
    });
    expect(none.status).toBe(502);
  });
});

describe("the describe agent", () => {
  it("is named as the contract says, and its prompt forbids identifying people", () => {
    expect(DESCRIBE_AGENT_ID).toBe("describe");
    expect(describeModule.Describe.agentName).toBe("describe");
    expect(DESCRIBE_PROMPT).toContain("Never identify, name or guess who a person");
    expect(DESCRIBE_PROMPT).toContain('{"title":"...","description":"...","tags":["..."]}');
  });

  it("reads the proposal and never a subject", () => {
    expect(descriptionFromReply('{"title":"Ridge","description":"A hike.","tags":["Hiking","hiking"],"subject":"Asif"}')).toEqual({
      title: "Ridge",
      description: "A hike.",
      tags: ["hiking"],
    });
    expect(descriptionFromReply('```json\n{"title":"Fenced","description":"","tags":[]}\n```')?.title).toBe("Fenced");
    expect(descriptionFromReply("Sure! Here you go.")).toBeUndefined();
    expect(descriptionFromReply('{"title":"","description":"","tags":[]}')).toBeUndefined();
  });

  it("resolves the waiting request from the bus, and refuses a non-image", async () => {
    const handlers: ((observation: FlueObservation) => void)[] = [];
    const dispatched: string[] = [];
    const describer = new ImageDescriber({
      subscribe: (handler) => {
        handlers.push(handler);
        return () => handlers.splice(handlers.indexOf(handler), 1);
      },
      dispatchJob: async (takeId) => {
        dispatched.push(takeId);
      },
      timeoutMs: 1_000,
    });
    await expect(describer.describe({ data: "abc", mimeType: "text/plain" })).rejects.toThrow(/Only an image/);

    const pending = describer.describe({ data: "abc", mimeType: "image/png" });
    const takeId = dispatched[0] ?? "";
    expect(takeId).toMatch(/^dsc_/);
    const envelope = { v: 3, eventIndex: 1, timestamp: "2026-09-22T00:00:00.000Z" } as const;
    for (const handler of handlers) {
      handler({
        type: "agent_end",
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: '{"title":"Ridge","description":"A hike.","tags":["hiking"]}' }],
            api: "t",
            provider: "t",
            model: "m",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop",
            timestamp: 0,
          },
        ],
        conversationId: "c",
        session: "default",
        harness: "default",
        operationId: "op",
        agentName: "describe",
        instanceId: takeId,
        submissionId: "sub_1",
        ...envelope,
      });
      handler({
        type: "submission_settled",
        submissionId: "sub_1",
        outcome: "completed",
        agentName: "describe",
        instanceId: takeId,
        ...envelope,
      });
    }
    await expect(pending).resolves.toEqual({ title: "Ridge", description: "A hike.", tags: ["hiking"] });
    describer.stop();
  });
});

describe("the environment block", () => {
  it("names the library and its tool only when a harness has one", () => {
    const without = environmentBlock(environmentFacts(root, new Date()));
    expect(without).not.toContain("library_search");
    const withLibrary = environmentBlock(
      environmentFacts(root, new Date(), "conversation", undefined, undefined, undefined, undefined, undefined, undefined, store.directory),
    );
    expect(withLibrary).toContain(store.directory);
    expect(withLibrary).toContain("library_search");
    expect(withLibrary).toMatch(/look at a picture and discuss it/);
  });
});
