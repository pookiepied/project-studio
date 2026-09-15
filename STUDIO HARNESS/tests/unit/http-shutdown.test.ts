import { afterAll, describe, expect, it } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { McpAdministration } from "../../src/application/mcp-management.js";
import type { SkillAdministration } from "../../src/application/skill-management.js";
import type { ProviderAdministration } from "../../src/gateway/connections/management.js";
import type { ConversationStore } from "../../src/conversations/store.js";
import type { ProjectStore } from "../../src/projects/store.js";
import { openDatabase } from "../../src/storage/database.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";

/**
 * The mountable stand-in for the studio agent: this suite never addresses
 * the agent mount, so the stand-in only has to be resolvable by
 * `createAgentRouter` when the app is built.
 */
function probeAgent(): string {
  return "shutdown probe";
}
probeAgent.agentName = "shutdown-probe";

// The conversation routes build their purge stores over this connection at
// composition time. This suite never purges, so one shared in-memory
// database holds still for the whole file.
const database = openDatabase({ path: ":memory:" });

afterAll(() => {
  database.close();
});

/**
 * Composes the real app the way `src/app.ts` does, minus everything the
 * admission boundary stops this route from ever reaching. The port doubles are
 * the two lines each route actually uses, in the same spirit as
 * `http-admission.test.ts`, because none of them can be entered on the paths
 * walked here: unauthenticated, wrong client type, and accepted.
 */
function composeApp(clientType: "studio-host" | "studio-client") {
  const session = createAdmissionSession({ clientType });
  let requested = 0;
  const app = createHttpApp({
    servers: { list: () => [] } as unknown as McpAdministration,
    skills: { list: () => [], problems: () => [] } as unknown as SkillAdministration,
    providers: {
      listConnections: () => [],
    } as unknown as ProviderAdministration,
    retrieval: {
      listRetrieval: () =>
        Promise.resolve({
          search: {
            capability: "search",
            providers: [],
            primary: "tavily",
            fallback: undefined,
          },
          reader: {
            capability: "reader",
            providers: [],
            primary: "jina",
            fallback: undefined,
          },
        }),
      setRetrievalKey: () => Promise.resolve(undefined),
      clearRetrievalKey: () => Promise.resolve(undefined),
      setRetrievalSlot: () => Promise.resolve(undefined),
    },
    media: {
      transcribe: () => Promise.resolve({ text: "" }),
      speak: () => Promise.resolve({ audio: "", mimeType: "audio/mpeg" }),
    },
    approvals: { list: () => [] } as unknown as PermissionApprovalBroker,
    conversations: {
      list: () => [],
    } as unknown as ConversationStore,
    projects: {
      list: () => [],
    } as unknown as ProjectStore,
    database,
    admission: session.verifier,
    // No submission in this suite carries turn settings; "nothing is served"
    // is the honest answer for the one check the middleware makes.
    isModelServed: async () => false,
    // A stand-in for "the process began its drain": the real one never returns
    // before exit, and a test that called it would end the test runner.
    requestShutdown: () => {
      requested += 1;
    },
    // This suite never addresses the agent mount; the stand-in only has to
    // be resolvable so the router can be built.
    agent: probeAgent,
  });
  return { app, session, requested: () => requested };
}

describe("POST /api/shutdown", () => {
  it("requires admission before the route is entered", async () => {
    const { app, requested } = composeApp("studio-host");

    const missing = await app.request("http://harness.test/api/shutdown", {
      method: "POST",
    });
    const wrong = await app.request("http://harness.test/api/shutdown", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
    });

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(requested()).toBe(0);
  });

  it("refuses a studio-client credential even though it is admitted", async () => {
    const { app, session, requested } = composeApp("studio-client");

    const response = await app.request("http://harness.test/api/shutdown", {
      method: "POST",
      headers: { authorization: `Bearer ${session.credential}` },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only the Studio host may stop the harness process.",
      code: "admission.client_type_required",
      clientType: "studio-host",
    });
    expect(requested()).toBe(0);
  });

  it("accepts the studio-host and asks exactly once", async () => {
    const { app, session, requested } = composeApp("studio-host");

    const response = await app.request("http://harness.test/api/shutdown", {
      method: "POST",
      headers: { authorization: `Bearer ${session.credential}` },
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(requested()).toBe(1);
  });
});
