import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { agentRegistry } from "../../src/agents/definitions/index.js";
import type { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { McpAdministration } from "../../src/application/mcp-management.js";
import type { RetrievalAdministration } from "../../src/application/retrieval-management.js";
import type { SkillAdministration } from "../../src/application/skill-management.js";
import type { ConversationStore } from "../../src/conversations/store.js";
import type { ProviderAdministration } from "../../src/gateway/connections/management.js";
import type { MediaAdministration } from "../../src/gateway/media/service.js";
import type { ProjectStore } from "../../src/projects/store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";

/**
 * The agent roster route (S5.3's Settings surface).
 *
 * The registry behind it is the real one — a route tested against a double
 * would prove nothing about the rows it serves — so what is under test is
 * the route's own contract: guarded by the agent scope (the run surface's
 * self-description rides the run scope), serving the registry's list
 * verbatim, and stating the delegate-only policy only for delegates. The
 * honest-list rule is the shape under test: a conversation row that
 * carried a static tool list would be a second, competing source for an
 * answer the conversation agent composes live.
 */

function probeAgent(): string {
  return "agents probe";
}
probeAgent.agentName = "agents-probe";

let db: StudioDatabase;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
});

afterEach(() => {
  db.close();
});

/** The app under test: every other surface a double, the registry real. */
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
    agents: agentRegistry,
  });
}

describe("the agent roster route", () => {
  it("refuses a request without credentials and a session without the agent scope", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);
    const scoped = createAdmissionSession({
      clientId: "desktop",
      clientType: "studio-client",
      scopes: [ADMISSION_SCOPES.APPROVAL],
    });

    const missing = await app.request("http://harness.test/api/agents");
    expect(missing.status).toBe(401);
    const noScope = await harnessApp(scoped).request("http://harness.test/api/agents", {
      headers: { authorization: `Bearer ${scoped.credential}` },
    });
    expect(noScope.status).toBe(403);
  });

  it("serves every registered agent under its own identity", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);

    const response = await app.request("http://harness.test/api/agents", {
      headers: { authorization: `Bearer ${session.credential}` },
    });
    expect(response.status).toBe(200);
    const roster = (await response.json()) as {
      agentName: string;
      kind: string;
    }[];
    expect(roster.map((entry) => entry.agentName)).toEqual([
      "describe",
      "explore",
      "general",
      "improve",
      "plan",
      "studio",
      "title",
    ]);
    const delegates = roster.filter((entry) => entry.kind === "delegate");
    expect(delegates.map((entry) => entry.agentName)).toEqual(["explore", "general", "plan"]);
  });

  it("states the delegate-only policy for delegates and none for the others", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);

    const response = await app.request("http://harness.test/api/agents", {
      headers: { authorization: `Bearer ${session.credential}` },
    });
    const roster = (await response.json()) as Record<string, unknown>[];

    const general = roster.find((entry) => entry["agentName"] === "general");
    expect(general?.["tools"]).toMatchObject({
      natives: ["read", "write", "edit", "glob", "grep", "git", "shell", "web_search", "fetch"],
      mcpNamespaces: ["*"],
    });
    expect(general?.["permissions"]).toMatchObject({
      maxEffects: ["read", "write", "execute", "network"],
      mode: "ask",
    });

    const studio = roster.find((entry) => entry["agentName"] === "studio");
    expect(studio?.["tools"]).toBeUndefined();
    expect(studio?.["skills"]).toBeUndefined();
    expect(studio?.["permissions"]).toBeUndefined();
  });
});
