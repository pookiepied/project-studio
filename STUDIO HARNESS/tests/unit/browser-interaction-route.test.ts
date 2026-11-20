import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { StudioRuntime } from "../../src/application/studio-runtime.js";
import type { BrowserInteraction } from "../../src/browser/interaction.js";
import { engineReport } from "../../src/browser/resolve.js";
import { createStudioUuid } from "../../src/contracts/uuid.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { BROWSER_SERVER_ID } from "../../src/extend/mcp/builtin.js";
import { conversationScope, ExtensionSelectionStore } from "../../src/extend/selection.js";
import { openDatabase } from "../../src/storage/database.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createConversationRoutes } from "../../src/transport/http/routes/conversations.js";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function build() {
  const db = openDatabase({ path: ":memory:" });
  databases.push(db);
  const conversations = new ConversationStore(db);
  conversations.record({ id: "cnv_live", firstMessage: "Browser fixture" });
  conversations.record({ id: "cnv_other", firstMessage: "Separate browser fixture" });
  const admission = createAdmissionSession({ scopes: ALL_ADMISSION_SCOPES });
  const interact = vi.fn<(id: string, input: BrowserInteraction) => Promise<unknown>>(
    async () => ({ accepted: true }),
  );
  const app = new Hono<AdmissionEnv>();
  app.use("*", createAdmissionMiddleware(admission.verifier));
  app.route("/api/conversations", createConversationRoutes({ database: db, conversations,
    browser: { stop: async () => false, interact } }));
  const post = (id: string, input: unknown, authorized = true) => app.request(`http://harness.test/api/conversations/${id}/browser/interact`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(authorized ? { Authorization: `Bearer ${admission.credential}` } : {}) },
    body: JSON.stringify(input),
  });
  return { db, interact, post };
}

describe("admitted browser interaction", () => {
  it("carries the path conversation and viewer, and never caches frames", async () => {
    const { interact, post } = build();
    const input = { action: "claim", viewerId: createStudioUuid() };
    const response = await post("cnv_live", input);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(interact).toHaveBeenCalledWith("cnv_live", input);
  });
  it("rejects missing admission, unknown conversations and malformed commands before dispatch", async () => {
    const { interact, post } = build();
    const input = { action: "claim", viewerId: createStudioUuid() };
    expect((await post("cnv_live", input, false)).status).toBe(401);
    expect((await post("cnv_missing", input)).status).toBe(404);
    expect((await post("cnv_live", { ...input, action: "evaluate", script: "steal()" })).status).toBe(400);
    expect(interact).not.toHaveBeenCalled();
  });

  it("returns an idle view through the real runtime without starting a server", async () => {
    const { db, interact, post } = build();
    const runtime = new StudioRuntime({ database: db, credentials: {
      get: async () => null, set: async () => undefined, delete: async () => false,
    } });
    interact.mockImplementation((id, input) => runtime.interactBrowser(id, input));
    const viewerId = createStudioUuid();
    try {
      const view = await post("cnv_live", { action: "view", viewerId });
      expect(view.status).toBe(200);
      expect(await view.json()).toEqual({
        running: false, activeTabId: null, tabs: [], control: "agent", busy: false, cursor: null, frame: null,
      });
      expect((await post("cnv_live", { action: "detach", viewerId })).status).toBe(200);
      expect((await post("cnv_live", { action: "claim", viewerId })).status).toBe(409);
    } finally {
      await runtime.stop();
    }
  });

  it("returns a safe explanation for upstream failures without replaying input", async () => {
    const { interact, post } = build();
    interact.mockRejectedValue(new Error("private upstream input"));
    const input = { action: "view", viewerId: createStudioUuid() };
    const response = await post("cnv_live", input);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Studio could not load the live browser. Select Reconnect to try again." });
    expect(interact).toHaveBeenCalledExactlyOnceWith("cnv_live", input);
  });

  it.skipIf(engineReport().seen === undefined)("starts a blank browser for an admitted viewer and keeps other conversations idle", async () => {
    const { db, interact, post } = build();
    const runtime = new StudioRuntime({ database: db, credentials: {
      get: async () => null, set: async () => undefined, delete: async () => false,
    } });
    interact.mockImplementation((id, input) => runtime.interactBrowser(id, input));
    const viewerId = createStudioUuid();
    try {
      const start = { action: "start", viewerId };
      expect((await post("cnv_live", start, false)).status).toBe(401);
      new ExtensionSelectionStore(db).set({ kind: "mcp", extensionId: BROWSER_SERVER_ID, scope: conversationScope("cnv_other") }, false);
      expect((await post("cnv_other", start)).status).toBe(409);
      expect(await (await post("cnv_live", { action: "view", viewerId })).json()).toMatchObject({ running: false });
      const opened = await post("cnv_live", start);
      expect(await opened.json()).toEqual({ accepted: true });
      expect(opened.status).toBe(200);
      expect(await (await post("cnv_live", start)).json()).toEqual({ accepted: true });
      expect(await (await post("cnv_live", { action: "view", viewerId })).json()).toMatchObject({
        running: true, control: "human", tabs: [{ url: "about:blank" }],
      });
      expect(await (await post("cnv_other", { action: "view", viewerId })).json()).toMatchObject({ running: false, tabs: [] });
    } finally {
      await runtime.stop();
    }
  });
});
