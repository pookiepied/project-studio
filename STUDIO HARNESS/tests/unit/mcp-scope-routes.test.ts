import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { McpManagementService } from "../../src/application/mcp-management.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { McpServerRegistry } from "../../src/extend/mcp/registry.js";
import {
  ExtensionSelectionStore,
  conversationScope,
  projectScope,
} from "../../src/extend/selection.js";
import type { McpSupervisor } from "../../src/extend/mcp/supervisor.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createMcpRoutes } from "../../src/transport/http/routes/mcp.js";

/**
 * The enablement decisions, through the routes, one scope at a time.
 *
 * The route is where each scope's decision gets its key, so this is where the
 * precedence question is answered in public: the same body, written to three
 * different routes, must land at three different scopes, and the narrowest
 * one must answer. What these tests pin is the pair of facts the settings
 * screens are built on - that a conversation's decision never lands at its
 * project's scope, and that an answered `null` clears rather than switches
 * off, because the wider scope's answer returning is a different thing from
 * off and the model's reach differs under the two.
 *
 * The service behind the routes is the real one over an in-memory store, so a
 * write that went to the wrong scope would not be caught here by a stub's
 * agreement; it would be caught by the resolution disagreeing.
 */

const COMMAND = process.platform === "win32" ? "C:\\tools\\node.exe" : "/usr/bin/node";

interface Built {
  readonly db: StudioDatabase;
  readonly selection: ExtensionSelectionStore;
  readonly app: Hono<AdmissionEnv>;
  readonly authorization: string;
}

function harness(): Built {
  const db = openDatabase({ path: ":memory:" });
  // Built first and handed to the service, so the tests can read the store's
  // rows directly: the question "did the route write at its own scope" is
  // answered against the store, not against a read that would agree either
  // way.
  const selection = new ExtensionSelectionStore(db);
  const management = new McpManagementService({
    registry: new McpServerRegistry(db),
    grants: new PermissionGrantStore(db),
    selection,
    extensions: { changed: () => undefined },
    supervisor: {
      stop: async () => undefined,
      status: () => ({ state: "idle" }) as ReturnType<McpSupervisor["status"]>,
    },
    // The harness's own project, plus where one conversation is filed - the
    // same fixed answers the unit suite supplies, so a resolution here can be
    // compared with the store's rows directly.
    projectId: "workspace-root",
    conversationProject: (conversationId) =>
      conversationId === "filed-conversation" ? "filed-project" : undefined,
  });

  const session = createAdmissionSession({ scopes: ALL_ADMISSION_SCOPES });
  const app = new Hono<AdmissionEnv>();
  app.use("*", createAdmissionMiddleware(session.verifier));
  app.route("/api/mcp", createMcpRoutes(management));
  return { db, selection, app, authorization: `Bearer ${session.credential}` };
}

async function install(app: Built["app"], authorization: string): Promise<void> {
  const saved = await app.request("http://harness.test/api/mcp/servers", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({
      id: "echo-server",
      title: "Echo server",
      transport: "stdio",
      command: COMMAND,
      args: [],
      env: {},
      auth: "none",
    }),
  });
  expect(saved.status).toBe(201);
}

async function decisionPut(
  app: Built["app"],
  authorization: string,
  path: string,
  enabled: unknown,
): Promise<Response> {
  // Hono's request answers a Response or a promise of one; the callers below
  // only ever want the one awaitable answer, so it is awaited here.
  return await app.request(`http://harness.test${path}`, {
    method: "PUT",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

interface Reading {
  readonly decision: boolean | null;
  readonly resolved: boolean;
  readonly decidedAt?: string;
}

interface ListedServer {
  readonly id: string;
  readonly project?: Reading;
  readonly conversation?: Reading;
}

async function readServer(
  app: Built["app"],
  authorization: string,
  query: string,
): Promise<ListedServer> {
  const response = await app.request(`http://harness.test/api/mcp/servers${query}`, {
    headers: { authorization },
  });
  expect(response.status).toBe(200);
  const rows = (await response.json()) as ListedServer[];
  const found = rows.find((row) => row.id === "echo-server");
  if (found === undefined) throw new Error("The saved server did not come back from the read.");
  return found;
}

describe("MCP enablement, through the routes", () => {
  let built: Built;
  let authorization: string;

  beforeEach(() => {
    built = harness();
    authorization = built.authorization;
  });

  afterEach(() => {
    built.db.close();
  });

  it("lands each scope's decision at its own scope, and the narrowest answers", async () => {
    await install(built.app, authorization);

    const wider = await decisionPut(
      built.app,
      authorization,
      "/api/mcp/extensions/mcp/echo-server",
      true,
    );
    expect(wider.status).toBe(200);

    const narrower = await decisionPut(
      built.app,
      authorization,
      "/api/mcp/conversations/c1/extensions/mcp/echo-server",
      false,
    );
    expect(narrower.status).toBe(200);

    // The conversation's decision is at the conversation's scope - the route
    // had exactly one fact to get right, and this is it. Reading the store
    // here, rather than trusting the read, is what makes the test catch a
    // route that wrote its decision at the wrong width: the read would still
    // answer, only about the wrong decision.
    expect(
      built.selection.decisionAt({
        kind: "mcp",
        extensionId: "echo-server",
        scope: conversationScope("c1"),
      }),
    ).toBe(false);
    expect(
      built.selection.decisionAt({
        kind: "mcp",
        extensionId: "echo-server",
        scope: projectScope("c1"),
      }),
    ).toBeUndefined();

    // And the chain answers narrowest-first: this conversation says off; its
    // sibling, with no opinion of its own, inherits the default's on.
    const c1 = await readServer(built.app, authorization, "?conversationId=c1");
    expect(c1.conversation).toEqual({ decision: false, resolved: false, decidedAt: "conversation" });

    const c2 = await readServer(built.app, authorization, "?conversationId=c2");
    expect(c2.conversation).toEqual({ decision: null, resolved: true, decidedAt: "global" });
  });

  it("clears, rather than switching off, when the conversation answers inherit", async () => {
    await install(built.app, authorization);
    expect(
      (await decisionPut(built.app, authorization, "/api/mcp/extensions/mcp/echo-server", true))
        .status,
    ).toBe(200);
    expect(
      (await decisionPut(built.app, authorization, "/api/mcp/conversations/c1/extensions/mcp/echo-server", true))
        .status,
    ).toBe(200);

    // The third value. `null` removes the conversation's opinion, so the
    // default's on comes back - which the resolution shows as `decidedAt:
    // "global"`, the reading a row displays when it says what inherit means.
    expect(
      (
        await decisionPut(built.app, authorization, "/api/mcp/conversations/c1/extensions/mcp/echo-server", null)
      ).status,
    ).toBe(200);
    expect(
      built.selection.decisionAt({
        kind: "mcp",
        extensionId: "echo-server",
        scope: conversationScope("c1"),
      }),
    ).toBeUndefined();

    const c1 = await readServer(built.app, authorization, "?conversationId=c1");
    expect(c1.conversation).toEqual({ decision: null, resolved: true, decidedAt: "global" });
  });

  it("answers the same questions for a project scope, the same way", async () => {
    await install(built.app, authorization);

    expect(
      (await decisionPut(built.app, authorization, "/api/mcp/extensions/mcp/echo-server", true)).status,
    ).toBe(200);
    expect(
      (
        await decisionPut(
          built.app,
          authorization,
          "/api/mcp/projects/filed-project/extensions/mcp/echo-server",
          false,
        )
      ).status,
    ).toBe(200);

    const filed = await readServer(built.app, authorization, "?conversationId=filed-conversation");
    // The conversation filed under the project inherits the project's off;
    // the project row itself reads the off as the project's own decision.
    expect(filed.conversation).toEqual({ decision: null, resolved: false, decidedAt: "project" });
    expect(
      built.selection.decisionAt({
        kind: "mcp",
        extensionId: "echo-server",
        scope: projectScope("filed-project"),
      }),
    ).toBe(false);

    // A conversation standing in no project falls back to the harness's own
    // project, which heard nothing: the default's on applies, and the reading
    // says whose it was.
    const loose = await readServer(built.app, authorization, "?conversationId=loose-conversation");
    expect(loose.conversation).toEqual({ decision: null, resolved: true, decidedAt: "global" });
  });

  it("refuses a conversation's decision with the project's own words", async () => {
    await install(built.app, authorization);

    // Not installed: the same error the project route answers, because the
    // person reading it is asking the same question one scope narrower.
    const missing = await decisionPut(
      built.app,
      authorization,
      "/api/mcp/conversations/c1/extensions/mcp/nothing",
      true,
    );
    expect(missing.status).toBe(400);

    // Not a decision: `enabled` takes true, false, or the third value, and
    // anything else is refused rather than coerced - a typo that silently
    // meant off would be a conversation that lost its tools for no reason.
    const malformed = await decisionPut(
      built.app,
      authorization,
      "/api/mcp/conversations/c1/extensions/mcp/echo-server",
      "yes",
    );
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { error: string }).error).toBe(
      "enabled must be true, false, or null to inherit.",
    );
  });

  it("answers a read about an unknown context honestly, not with a 404", async () => {
    await install(built.app, authorization);
    expect(
      (await decisionPut(built.app, authorization, "/api/mcp/extensions/mcp/echo-server", true)).status,
    ).toBe(200);

    // An id with no rows is a context nobody has decided about, which the
    // wider scopes answer for. The selection store keeps no registry of
    // scopes, so there is nothing here to look up and nothing to refuse.
    const strange = await readServer(built.app, authorization, "?conversationId=ghost&projectId=also-ghost");
    expect(strange.conversation).toEqual({ decision: null, resolved: true, decidedAt: "global" });
    expect(strange.project).toEqual({ decision: null, resolved: true, decidedAt: "global" });
  });

  it("keeps the global read free of narrower readings", async () => {
    await install(built.app, authorization);
    expect(
      (await decisionPut(built.app, authorization, "/api/mcp/extensions/mcp/echo-server", true)).status,
    ).toBe(200);
    expect(
      (await decisionPut(built.app, authorization, "/api/mcp/conversations/c1/extensions/mcp/echo-server", false))
        .status,
    ).toBe(200);

    // No query, no readings: the settings screen that edits the default asks
    // the default question, and its rows say nothing about a context they do
    // not mean. (Whether a conversation disagrees, that conversation's own
    // screen answers.)
    const listed = await readServer(built.app, authorization, "");
    expect(listed.conversation).toBeUndefined();
    expect(listed.project).toBeUndefined();
  });
  it("keeps the network switch the form sent, instead of granting one anyway", async () => {
    // The route used to drop needsNetwork, so the registry's default of true
    // applied to every save and a server the user had denied a network was
    // given one. The screen showed the boundary; the harness was not applying
    // it.
    const saved = await built.app.request("http://harness.test/api/mcp/servers", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        id: "offline-server",
        title: "Offline server",
        transport: "stdio",
        command: COMMAND,
        args: [],
        env: {},
        auth: "none",
        needsNetwork: false,
      }),
    });
    expect(saved.status).toBe(201);
    expect(((await saved.json()) as { needsNetwork: boolean }).needsNetwork).toBe(false);
  });

  it("refuses a network switch that is not a switch", async () => {
    const saved = await built.app.request("http://harness.test/api/mcp/servers", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        id: "bad-server",
        title: "Bad server",
        transport: "stdio",
        command: COMMAND,
        args: [],
        env: {},
        auth: "none",
        needsNetwork: "no",
      }),
    });
    expect(saved.status).toBe(400);
  });
});
