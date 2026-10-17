import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { createStudioUuid } from "../../src/contracts/uuid.js";
import { ConversationStore } from "../../src/conversations/store.js";
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
  const admission = createAdmissionSession({ scopes: ALL_ADMISSION_SCOPES });
  const interact = vi.fn(async () => ({ accepted: true }));
  const app = new Hono<AdmissionEnv>();
  app.use("*", createAdmissionMiddleware(admission.verifier));
  app.route("/api/conversations", createConversationRoutes({ database: db, conversations,
    browser: { stop: async () => false, interact } }));
  const post = (id: string, input: unknown, authorized = true) => app.request(`http://harness.test/api/conversations/${id}/browser/interact`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(authorized ? { Authorization: `Bearer ${admission.credential}` } : {}) },
    body: JSON.stringify(input),
  });
  return { interact, post };
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
    expect((await post("cnv_live", { ...input, action: "evaluate", script: "steal()" })).status).toBeGreaterThanOrEqual(400);
    expect(interact).not.toHaveBeenCalled();
  });
});
