import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FlueObservation } from "@flue/runtime";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { desktopReleaseFor } from "../../src/application/studio-runtime.js";
import type { ConversationStore } from "../../src/conversations/store.js";
import { McpCapabilityCatalog, systemActorMeta } from "../../src/extend/mcp/capabilities.js";
import type { McpServerRecord } from "../../src/extend/mcp/registry.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createConversationRoutes } from "../../src/transport/http/routes/conversations.js";

/**
 * The harness half of the desktop lease (ADR 0059): who the computer server
 * is told is calling, when a finished run gives the desktop back, and the
 * person's own controls reaching the lease with no model in between.
 */

const scope = (agentId: string) => ({ agentId, conversationId: "conv_1", projectId: undefined });

describe("the actor a system-server call names", () => {
  it("is the conversation's own agent, typed or spoken, and its delegates ride it", () => {
    expect(systemActorMeta(scope("studio"), "conv_1", () => undefined)).toEqual({ "studio/actor": "conv_1", "studio/role": "conversation" });
    expect(systemActorMeta(scope("voice"), "conv_1", () => undefined)).toEqual({ "studio/actor": "conv_1", "studio/role": "voice" });
    expect(systemActorMeta(scope("explore"), "conv_1", () => undefined)).toEqual({ "studio/actor": "conv_1", "studio/role": "conversation" });
    expect(systemActorMeta(scope("studio"), undefined, () => undefined)).toEqual({ "studio/actor": "conv_1", "studio/role": "conversation" });
  });

  it("is the worker's own instance, with its spoken name, for a voice task and its delegates", () => {
    expect(systemActorMeta(scope("voice-work"), "voice_abc", (id) => id === "voice_abc" ? "Hazel" : undefined))
      .toEqual({ "studio/actor": "voice_abc", "studio/role": "worker", "studio/actor-name": "Hazel" });
    expect(systemActorMeta(scope("explore"), "voice_abc", () => undefined))
      .toEqual({ "studio/actor": "voice_abc", "studio/role": "worker" });
  });
});

describe("the actor reaches only Studio's own servers", () => {
  let workspace: string;
  beforeEach(() => { workspace = mkdtempSync(join(tmpdir(), "studio-actor-meta-")); });
  afterEach(() => { rmSync(workspace, { recursive: true, force: true }); });

  async function callOn(provenance: "system" | "user"): Promise<unknown> {
    const record: McpServerRecord = {
      id: "studio-computer", title: "Computer", description: "", provenance, transport: "stdio",
      command: "/usr/bin/node", args: [], env: {}, auth: "none", needsNetwork: false,
    };
    let sent: unknown;
    const catalog = new McpCapabilityCatalog({ actorMeta: () => ({ "studio/actor": "voice_abc", "studio/role": "worker" }) });
    const [tool] = await catalog.refresh(record, {
      request: async (method: string, params?: unknown) => {
        if (method === "tools/list") return { tools: [{ name: "studio_computer_status", description: "", inputSchema: { type: "object" } }] };
        sent = params;
        return { content: [] };
      },
    });
    if (tool === undefined) throw new Error("no tool");
    await tool.execute({}, { scope: scope("voice-work"), sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })), signal: new AbortController().signal });
    return sent;
  }

  it("names the actor beside the conversation for a system server", async () => {
    expect(await callOn("system")).toMatchObject({ _meta: { "studio/conversation": "conv_1", "studio/actor": "voice_abc", "studio/role": "worker" } });
  });

  it("never hands a third party's server the conversation or the actor", async () => {
    expect(JSON.stringify(await callOn("user"))).not.toMatch(/studio\/(actor|conversation|role)/);
  });
});

describe("a finished run gives the desktop back", () => {
  const settled = (instanceId: string, submissionId: string, agentName: string): FlueObservation =>
    ({ type: "submission_settled", instanceId, submissionId, agentName, outcome: "completed" }) as unknown as FlueObservation;
  const tasks = new Map([["voice_abc", { agentName: "voice-work", parentConversationId: "conv_1", originSubmissionId: "sub_origin" }]]);

  it("frees a worker when its original submission settles, never on a steer's receipt", () => {
    expect(desktopReleaseFor(settled("voice_abc", "sub_origin", "voice-work"), (id) => tasks.get(id))).toEqual({ conversationId: "conv_1", actor: "voice_abc" });
    expect(desktopReleaseFor(settled("voice_abc", "sub_steer", "voice-work"), (id) => tasks.get(id))).toBeUndefined();
  });

  it("frees the conversation's own agent when its run settles, and ignores everyone else", () => {
    expect(desktopReleaseFor(settled("conv_1", "sub_1", "studio"), () => undefined)).toEqual({ conversationId: "conv_1", actor: "conv_1" });
    expect(desktopReleaseFor(settled("title_1", "sub_1", "title"), () => undefined)).toBeUndefined();
    expect(desktopReleaseFor({ type: "turn_start", instanceId: "conv_1", agentName: "studio" } as unknown as FlueObservation, () => undefined)).toBeUndefined();
  });
});

describe("the person's desktop controls", () => {
  let db: StudioDatabase;
  beforeEach(() => { db = openDatabase({ path: ":memory:" }); });
  afterEach(() => { db.close(); });

  function build(control?: (id: string, action: string) => Promise<unknown>) {
    const session = createAdmissionSession({ scopes: ALL_ADMISSION_SCOPES });
    const app = new Hono<AdmissionEnv>();
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.route("/api/conversations", createConversationRoutes({
      conversations: { list: () => [], get: (id: string) => id === "cnv_7" ? { id } : undefined } as unknown as ConversationStore,
      database: db,
      computer: { stop: async () => false, ...(control === undefined ? {} : { control }) },
    }));
    return (path: string, body: unknown) => app.request(`http://harness.test/api/conversations/${path}`, {
      method: "POST", headers: { authorization: `Bearer ${session.credential}`, "content-type": "application/json" }, body: JSON.stringify(body),
    });
  }

  it("hands the action straight to the lease for that conversation and answers what it said", async () => {
    const asked: string[] = [];
    const post = build(async (id, action) => { asked.push(`${id}:${action}`); return { result: "paused", heldInput: "released" }; });
    const response = await post("cnv_7/computer/control", { action: "pause" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "paused", heldInput: "released" });
    expect(asked).toEqual(["cnv_7:pause"]);
  });

  it("refuses an unknown action, an unknown conversation, and a composition without control", async () => {
    const post = build(async () => ({}));
    expect((await post("cnv_7/computer/control", { action: "acquire" })).status).toBe(400);
    expect((await post("cnv_missing/computer/control", { action: "pause" })).status).toBe(404);
    expect((await build()("cnv_7/computer/control", { action: "pause" })).status).toBe(503);
  });
});
