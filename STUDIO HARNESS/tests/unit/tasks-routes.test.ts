import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { AgentTaskRecord } from "../../src/agents/definitions/task-store.js";
import { TaskStore } from "../../src/agents/definitions/task-store.js";
import type { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { McpAdministration } from "../../src/application/mcp-management.js";
import type { RetrievalAdministration } from "../../src/application/retrieval-management.js";
import type { SkillAdministration } from "../../src/application/skill-management.js";
import { IMPROVE_AGENT_ID, TITLE_AGENT_ID } from "../../src/contracts/agents.js";
import type { ConversationStore } from "../../src/conversations/store.js";
import type { ProviderAdministration } from "../../src/gateway/connections/management.js";
import type { MediaAdministration } from "../../src/gateway/media/service.js";
import type { ProjectStore } from "../../src/projects/store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";

/**
 * The background tasks' routes (ADR 0058 D5, S4.1).
 *
 * Under test is the route layer's own contract, and three things about it:
 * the surface is guarded by the agent scope - the same one the agent router
 * holds, because these are agent work and no second scope vocabulary exists
 * for it; the listing is narrowed by the query parameters the rail asks
 * with; and the cancel refuses a settled task at the route, before the port
 * is ever consulted, so a settled row cannot be made to look stoppable.
 * The store behind the routes is real, because a route tested against a
 * double would prove nothing about the rows it serves.
 */

function probeAgent(): string {
  return "tasks probe";
}
probeAgent.agentName = "tasks-probe";

let db: StudioDatabase;
let tasks: TaskStore;

/** What the cancel port received, and what it answered. */
const controlCalls: string[] = [];

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  tasks = new TaskStore(db);
  controlCalls.length = 0;
});

afterEach(() => {
  db.close();
});

/** The app under test: every other surface a double, the task store real. */
function harnessApp(session: ReturnType<typeof createAdmissionSession>) {
  return createHttpApp({
    servers: { list: () => [] } as unknown as McpAdministration,
    skills: { list: () => [], problems: () => [] } as unknown as SkillAdministration,
    providers: { listConnections: () => [] } as unknown as ProviderAdministration,
    retrieval: {} as unknown as RetrievalAdministration,
    media: {} as unknown as MediaAdministration,
    approvals: {} as unknown as PermissionApprovalBroker,
    grants: {} as unknown as Parameters<typeof createHttpApp>[0]["grants"],
    conversations: { list: () => [] } as unknown as ConversationStore,
    projects: { list: () => [] } as unknown as ProjectStore,
    database: db,
    admission: session.verifier,
    isModelServed: async () => false,
    requestShutdown: () => undefined,
    agent: probeAgent,
    tasks,
    taskControl: {
      cancel: async (task: AgentTaskRecord) => {
        controlCalls.push(task.id);
        return true;
      },
    },
  });
}

describe("the background tasks' routes", () => {
  it("requires a conversation for live progress and protects it with admission", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);
    expect((await app.request("http://harness.test/api/tasks/activity?parentConversationId=c")).status).toBe(401);
    const headers = { authorization: `Bearer ${session.credential}` };
    expect((await app.request("http://harness.test/api/tasks/activity", { headers })).status).toBe(400);
    const result = await app.request("http://harness.test/api/tasks/activity?parentConversationId=c", { headers });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ tasks: [], evidence: "live_process" });
  });

  it("refuse a request without and with wrong credentials", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);

    const missing = await app.request("http://harness.test/api/tasks");
    expect(missing.status).toBe(401);
    const wrong = await app.request("http://harness.test/api/tasks", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(wrong.status).toBe(401);
  });

  it("refuse a session that holds no agent scope", async () => {
    // Every operational scope except the agent's: this session may answer
    // approvals and manage providers, and must still not reach the tasks -
    // the same scope the agent router holds, for the same work.
    const session = createAdmissionSession({
      clientId: "desktop",
      clientType: "studio-client",
      scopes: [ADMISSION_SCOPES.APPROVAL],
    });
    const app = harnessApp(session);
    tasks.record({ id: "cnv_a-t1", agentName: TITLE_AGENT_ID });

    const listed = await app.request("http://harness.test/api/tasks", {
      headers: { authorization: `Bearer ${session.credential}` },
    });
    expect(listed.status).toBe(403);
    const read = await app.request("http://harness.test/api/tasks/cnv_a-t1", {
      headers: { authorization: `Bearer ${session.credential}` },
    });
    expect(read.status).toBe(403);
    const cancelled = await app.request("http://harness.test/api/tasks/cnv_a-t1/cancel", {
      method: "POST",
      headers: { authorization: `Bearer ${session.credential}` },
    });
    expect(cancelled.status).toBe(403);
    expect(controlCalls).toEqual([]);
  });

  it("list the rows newest first, narrowed by the query's columns", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);
    tasks.record({ id: "imp_a", agentName: IMPROVE_AGENT_ID, parentConversationId: "cnv_1" });
    tasks.record({ id: "cnv_b-t1", agentName: TITLE_AGENT_ID, parentConversationId: "cnv_2" });

    const authorized = { authorization: `Bearer ${session.credential}` };
    const all = (await (await app.request("http://harness.test/api/tasks", { headers: authorized })).json()) as {
      id: string;
    }[];
    expect(all.map((task) => task.id)).toEqual(["cnv_b-t1", "imp_a"]);

    const narrowed = (await (
      await app.request("http://harness.test/api/tasks?parentConversationId=cnv_1", {
        headers: authorized,
      })
    ).json()) as { id: string }[];
    expect(narrowed.map((task) => task.id)).toEqual(["imp_a"]);
  });

  it("read one row and answer 404 for an id that does not exist", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);
    tasks.record({ id: "cnv_a-t1", agentName: TITLE_AGENT_ID });
    const authorized = { authorization: `Bearer ${session.credential}` };

    const read = await app.request("http://harness.test/api/tasks/cnv_a-t1", { headers: authorized });
    expect(read.status).toBe(200);
    expect(((await read.json()) as { agentName: string }).agentName).toBe(TITLE_AGENT_ID);

    const missing = await app.request("http://harness.test/api/tasks/cnv_nobody", {
      headers: authorized,
    });
    expect(missing.status).toBe(404);
  });

  it("cancel a live task through the port and refuse a settled one at the route", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);
    tasks.record({ id: "cnv_a-t1", agentName: TITLE_AGENT_ID });
    tasks.record({ id: "cnv_b-t1", agentName: TITLE_AGENT_ID });
    tasks.setStatus("cnv_b-t1", "completed", "Titled.");
    const authorized = { authorization: `Bearer ${session.credential}` };

    const live = await app.request("http://harness.test/api/tasks/cnv_a-t1/cancel", {
      method: "POST",
      headers: authorized,
    });
    expect(live.status).toBe(200);
    expect((await live.json()) as { cancelled: boolean }).toEqual({ cancelled: true });
    expect(controlCalls).toEqual(["cnv_a-t1"]);

    const settled = await app.request("http://harness.test/api/tasks/cnv_b-t1/cancel", {
      method: "POST",
      headers: authorized,
    });
    expect(settled.status).toBe(200);
    expect((await settled.json()) as { cancelled: boolean }).toEqual({ cancelled: false });
    // The settled refusal happened before the port: one cancel, no more.
    expect(controlCalls).toEqual(["cnv_a-t1"]);

    const missing = await app.request("http://harness.test/api/tasks/cnv_nobody/cancel", {
      method: "POST",
      headers: authorized,
    });
    expect(missing.status).toBe(404);
  });
});
