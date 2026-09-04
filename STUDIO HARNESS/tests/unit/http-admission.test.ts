import { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";
import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { McpAdministration } from "../../src/application/mcp-management.js";
import type { ProviderAdministration } from "../../src/providers/management.js";
import type { ConversationStore } from "../../src/conversations/store.js";
import type { ProjectStore } from "../../src/projects/store.js";
import { openDatabase } from "../../src/storage/database.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";
import {
  authContext,
  createAdmissionMiddleware,
  executionContext,
  requireAdmissionScope,
  type AdmissionEnv,
} from "../../src/transport/http/middleware/admission.js";

/**
 * The mountable stand-in for the studio agent. Flue 2.0's routers resolve
 * their identity from the function (its `agentName` static here), and the
 * suite only needs the mount to exist so admission can be proven to sit
 * before it. No cast: a named function carrying the static satisfies
 * `Agent` structurally.
 */
function probeAgent(): string {
  return "ordering probe";
}
probeAgent.agentName = "ordering-probe";

// The conversation routes build their purge stores over this connection at
// composition time. This suite never purges, so one shared in-memory
// database holds still for the whole file.
const database = openDatabase({ path: ":memory:" });

afterAll(() => {
  database.close();
});

describe("Harness HTTP admission", () => {
  it("stops a route before its handler for missing and wrong credentials", async () => {
    const session = createAdmissionSession();
    const app = new Hono<AdmissionEnv>();
    let entered = 0;
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.get("/probe", (context) => {
      entered += 1;
      return context.json({ clientId: authContext(context).clientId });
    });

    const missing = await app.request("http://harness.test/probe");
    const wrong = await app.request("http://harness.test/probe", {
      headers: { authorization: "Bearer wrong-token" },
    });

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(entered).toBe(0);
  });

  it("stores AuthContext and separates scope authorization", async () => {
    const session = createAdmissionSession({
      clientId: "desktop",
      clientType: "studio-client",
      scopes: [ADMISSION_SCOPES.AGENT_RUN],
    });
    const app = new Hono<AdmissionEnv>();
    let entered = 0;
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.use("/managed", requireAdmissionScope(ADMISSION_SCOPES.EXTENSION_MANAGEMENT));
    app.get("/managed", (context) => {
      entered += 1;
      return context.json({ clientId: authContext(context).clientId });
    });

    const response = await app.request("http://harness.test/managed", {
      headers: { authorization: `Bearer ${session.credential}` },
    });

    expect(response.status).toBe(403);
    expect(entered).toBe(0);
  });

  it("creates one request execution context after admission", async () => {
    const session = createAdmissionSession({ clientId: "desktop", sessionId: "session-1" });
    const app = new Hono<AdmissionEnv>();
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.get("/probe", (context) => {
      const execution = executionContext(context);
      return context.json({
        requestId: execution.requestId,
        clientId: execution.clientId,
        sessionId: execution.sessionId,
      });
    });
    const requestId = "6f5e6e6c-3a3a-4b12-9c55-1d253ce34db0";

    const response = await app.request("http://harness.test/probe", {
      headers: {
        authorization: `Bearer ${session.credential}`,
        "X-Project-Studio-Request-Id": requestId,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      requestId,
      clientId: "desktop",
      sessionId: "session-1",
    });
  });

  it("places one admission boundary before the agent mount, MCP, and permission routes", async () => {
    const session = createAdmissionSession();
    let mcpEntered = 0;
    let permissionEntered = 0;
    let providerEntered = 0;
    let retrievalEntered = 0;
    let conversationEntered = 0;
    let projectEntered = 0;

    const app = createHttpApp({
      // A port, so the double is the three lines the route actually uses
      // rather than a cast of the whole runtime.
      servers: {
        list: () => {
          mcpEntered += 1;
          return [];
        },
      } as unknown as McpAdministration,
      providers: {
        listConnections: () => {
          providerEntered += 1;
          return [];
        },
      } as unknown as ProviderAdministration,
      retrieval: {
        // A retrieval port double in the same minimal spirit as the others;
        // the full shape without a cast, because admission never gets that
        // far on the paths this test walks.
        listRetrieval: () => {
          retrievalEntered += 1;
          return Promise.resolve({
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
          });
        },
        setRetrievalKey: () => Promise.resolve(undefined),
        clearRetrievalKey: () => Promise.resolve(undefined),
        setRetrievalSlot: () => Promise.resolve(undefined),
      },
      media: {
        transcribe: () => Promise.resolve({ text: "" }),
        speak: () => Promise.resolve({ audio: "", mimeType: "audio/mpeg" }),
      },
      approvals: {
        list: () => {
          permissionEntered += 1;
          return [];
        },
      } as unknown as PermissionApprovalBroker,
      conversations: {
        list: () => {
          conversationEntered += 1;
          return [];
        },
      } as unknown as ConversationStore,
      projects: {
        list: () => {
          projectEntered += 1;
          return [];
        },
      } as unknown as ProjectStore,
      database,
      admission: session.verifier,
      // No submission in this suite carries turn settings; "nothing is
      // served" is the honest answer for the one check the middleware makes.
      isModelServed: async () => false,
      // Never exercised here; required so the route cannot be mounted without
      // a way to actually stop the process.
      requestShutdown: () => undefined,
      // A stand-in agent: this suite never reaches a run, so the mount's
      // identity only has to be resolvable by createAgentRouter.
      agent: probeAgent,
    });

    for (const path of [
      "/agents/studio/ordering-probe",
      "/api/mcp/servers",
      "/api/permissions/pending",
      "/api/providers/connections",
      "/api/providers/retrieval",
      "/api/conversations",
      "/api/projects",
    ]) {
      const response = await app.request(`http://harness.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status, path).toBe(401);

      const wrong = await app.request(`http://harness.test${path}`, {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-token",
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(wrong.status, path).toBe(401);
    }
    expect(mcpEntered).toBe(0);
    expect(permissionEntered).toBe(0);
    expect(providerEntered).toBe(0);
    expect(retrievalEntered).toBe(0);
    expect(conversationEntered).toBe(0);
    expect(projectEntered).toBe(0);

    // The boundary is provably BEFORE the agent mount: an admitted request
    // to a mounted path is no longer answered by admission at all. Without
    // a Flue runtime in this test process the router itself refuses the
    // submission - which is exactly the proof that the request crossed the
    // boundary and reached the mount (a 401 would mean admission ate it).
    const admitted = await app.request(
      "http://harness.test/agents/studio/ordering-probe",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.credential}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(admitted.status).not.toBe(401);
    const admittedMcp = await app.request("http://harness.test/api/mcp/servers", {
      headers: { authorization: `Bearer ${session.credential}` },
    });
    const admittedPermissions = await app.request("http://harness.test/api/permissions/pending", {
      headers: { authorization: `Bearer ${session.credential}` },
    });
    const admittedProviders = await app.request(
      "http://harness.test/api/providers/connections",
      {
        headers: { authorization: `Bearer ${session.credential}` },
      },
    );
    expect(admittedMcp.status).toBe(200);
    expect(admittedPermissions.status).toBe(200);
    expect(admittedProviders.status).toBe(200);
    expect(mcpEntered).toBe(1);
    expect(permissionEntered).toBe(1);
    expect(providerEntered).toBe(1);
  });
});
