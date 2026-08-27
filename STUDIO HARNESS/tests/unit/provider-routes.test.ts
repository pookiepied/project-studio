import { Hono } from "hono";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { McpAdministration } from "../../src/application/mcp-management.js";
import { ProviderManagementService } from "../../src/application/provider-management.js";
import { RetrievalManagementService } from "../../src/application/retrieval-management.js";
import { RetrievalSettingsStore } from "../../src/retrieval/settings.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { ProjectStore } from "../../src/projects/store.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { ConnectionStore } from "../../src/providers/connection-store.js";
import { ModelCatalog } from "../../src/providers/model-catalog.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";
import { createProviderRoutes } from "../../src/transport/http/routes/providers.js";
import {
  createAdmissionMiddleware,
  requireAdmissionScope,
  type AdmissionEnv,
} from "../../src/transport/http/middleware/admission.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

const OPENAI_DRAFT = {
  id: "work-openai",
  displayName: "Work OpenAI",
  kind: "language",
  source: "local",
  baseUrl: "https://api.openai.com/v1",
  enabled: true,
  catalogProvider: "openai",
  protocol: "openai-responses",
};

let db: StudioDatabase;
let credentials: InMemoryCredentialStore;
let app: ReturnType<typeof createHttpApp>;
let session: ReturnType<typeof createAdmissionSession>;
let probeServer: Server | undefined;
let probeRequests: IncomingMessage[];

function authorized(path: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app.request(`http://harness.test${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${session.credential}`,
        "content-type": "application/json",
      },
    }),
  );
}

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  credentials = new InMemoryCredentialStore();
  const connections = new ConnectionStore({ db, credentials });
  session = createAdmissionSession();
  const flueApp = new Hono();
  flueApp.get("/probe", () => new Response("entered"));
  app = createHttpApp({
    servers: { list: () => [] } as unknown as McpAdministration,
    providers: new ProviderManagementService({
      connections,
      catalog: new ModelCatalog({ db, connections }),
    }),
    retrieval: new RetrievalManagementService({
      settings: new RetrievalSettingsStore(db),
      credentials,
    }),
    approvals: { list: () => [] } as unknown as PermissionApprovalBroker,
    conversations: new ConversationStore(db),
    projects: new ProjectStore(db),
    admission: session.verifier,
    // No submission in this suite carries turn settings; "nothing is served"
    // is the honest answer for the one check the middleware makes.
    isModelServed: async () => false,
    // This suite never posts to the shutdown route; the no-op keeps the
    // process out of a composition that would otherwise be able to end it.
    requestShutdown: () => undefined,
    flueApp,
  });
});

afterEach(() => {
  db.close();
  if (probeServer !== undefined) {
    probeServer.closeAllConnections();
    probeServer.close();
    probeServer = undefined;
  }
});

describe("provider routes", () => {
  it("requires the provider-management scope", async () => {
    // Its own admission boundary with a session that holds a different scope,
    // so the 403 comes from the route's guard rather than a foreign
    // credential being rejected as a 401.
    const limited = createAdmissionSession({
      scopes: [ADMISSION_SCOPES.AGENT_RUN],
    });
    const connections = new ConnectionStore({ db, credentials });
    const scopedApp = new Hono<AdmissionEnv>();
    scopedApp.use("*", createAdmissionMiddleware(limited.verifier));
    scopedApp.route(
      "/api/providers",
      createProviderRoutes(
        new ProviderManagementService({
          connections,
          catalog: new ModelCatalog({ db, connections }),
        }),
      ),
    );

    const response = await scopedApp.request(
      "http://harness.test/api/providers/connections",
      { headers: { authorization: `Bearer ${limited.credential}` } },
    );

    expect(response.status).toBe(403);
  });

  it("narrows what a studio-client session may do by default", async () => {
    // No explicit scopes: whatever a studio-client is trusted with arrives
    // from the client-type table, which is the behavior under test.
    const client = createAdmissionSession({ clientType: "studio-client" });
    const connections = new ConnectionStore({ db, credentials });
    const clientApp = new Hono<AdmissionEnv>();
    clientApp.use("*", createAdmissionMiddleware(client.verifier));
    clientApp.use("/probe", requireAdmissionScope(ADMISSION_SCOPES.AGENT_RUN));
    clientApp.get("/probe", () => new Response("entered"));
    clientApp.route(
      "/api/providers",
      createProviderRoutes(
        new ProviderManagementService({
          connections,
          catalog: new ModelCatalog({ db, connections }),
        }),
      ),
    );
    const headers = { authorization: `Bearer ${client.credential}` };

    // Inside the default set: the agent route (agent:run).
    const agent = await clientApp.request("http://harness.test/probe", {
      headers,
    });
    expect(agent.status).toBe(200);

    // Outside it: provider management. The refusal must be the scope guard's
    // 403 shape, not a crashed handler's 500.
    const refused = await clientApp.request(
      "http://harness.test/api/providers/connections",
      { headers },
    );
    expect(refused.status).toBe(403);
    expect(JSON.parse(await refused.text())).toEqual({
      error: "The authenticated client is not authorized for this operation.",
      code: "admission.scope_required",
      scope: "provider-management",
    });
  });

  it("keeps every scope for the studio-host the shipped app speaks as", async () => {
    const host = createAdmissionSession({ clientType: "studio-host" });
    const connections = new ConnectionStore({ db, credentials });
    const hostApp = new Hono<AdmissionEnv>();
    hostApp.use("*", createAdmissionMiddleware(host.verifier));
    hostApp.route(
      "/api/providers",
      createProviderRoutes(
        new ProviderManagementService({
          connections,
          catalog: new ModelCatalog({ db, connections }),
        }),
      ),
    );

    const response = await hostApp.request(
      "http://harness.test/api/providers/connections",
      { headers: { authorization: `Bearer ${host.credential}` } },
    );

    expect(response.status).toBe(200);
  });

  it("never echoes a submitted API key in any response", async () => {
    const secret = "sk-live-route-secret-9f3a";
    const created = await authorized("/api/providers/connections", {
      method: "POST",
      body: JSON.stringify({ ...OPENAI_DRAFT, apiKey: secret }),
    });

    expect(created.status).toBe(201);
    const createdText = await created.text();
    expect(createdText).not.toContain(secret);
    expect(JSON.parse(createdText).credential).toBe("set");

    const listed = await authorized("/api/providers/connections");
    expect(listed.status).toBe(200);
    expect(await listed.text()).not.toContain(secret);

    const models = await authorized("/api/providers/models?connectionId=work-openai");
    expect(models.status).toBe(200);
    expect(await models.text()).not.toContain(secret);
  });

  it("round-trips a connection, its models, its defaults, and its removal", async () => {
    const created = await authorized("/api/providers/connections", {
      method: "POST",
      body: JSON.stringify(OPENAI_DRAFT),
    });
    expect(created.status).toBe(201);
    expect(JSON.parse(await created.text())).toMatchObject({
      id: "work-openai",
      credential: "absent",
    });

    const catalogModels = await authorized(
      "/api/providers/models?connectionId=work-openai&kind=language",
    );
    expect(catalogModels.status).toBe(200);
    const catalogList = JSON.parse(await catalogModels.text());
    expect(catalogList.length).toBeGreaterThan(0);
    const target = catalogList[0].modelId;

    const manual = await authorized("/api/providers/connections/work-openai/models", {
      method: "POST",
      body: JSON.stringify({
        modelId: "self-hosted-gpt",
        displayName: "Self Hosted GPT",
        capability: { toolCalling: "supported" },
      }),
    });
    expect(manual.status).toBe(201);
    expect(JSON.parse(await manual.text())).toMatchObject({
      connectionId: "work-openai",
      modelId: "self-hosted-gpt",
      origin: "manual",
    });

    const renamed = await authorized(
      `/api/providers/connections/work-openai/models/${encodeURIComponent(target)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ displayName: "User Name" }),
      },
    );
    expect(renamed.status).toBe(200);
    expect(JSON.parse(await renamed.text()).displayName).toBe("User Name");

    const defaulted = await authorized("/api/providers/defaults/textGeneration", {
      method: "PUT",
      body: JSON.stringify({
        connectionId: "work-openai",
        modelId: "self-hosted-gpt",
      }),
    });
    expect(defaulted.status).toBe(204);

    const defaults = await authorized("/api/providers/defaults");
    expect(JSON.parse(await defaults.text()).textGeneration).toEqual({
      connectionId: "work-openai",
      modelId: "self-hosted-gpt",
    });

    const clearedDefault = await authorized(
      "/api/providers/defaults/textGeneration",
      { method: "DELETE" },
    );
    expect(clearedDefault.status).toBe(204);
    expect(JSON.parse(await (await authorized("/api/providers/defaults")).text()))
      .toEqual({});

    const removedModel = await authorized(
      "/api/providers/connections/work-openai/models/self-hosted-gpt",
      { method: "DELETE" },
    );
    expect(removedModel.status).toBe(204);

    const removedConnection = await authorized(
      "/api/providers/connections/work-openai",
      { method: "DELETE" },
    );
    expect(removedConnection.status).toBe(204);
    expect(
      JSON.parse(await (await authorized("/api/providers/connections")).text()),
    ).toEqual([]);
    expect(await credentials.get({ scope: "provider-connection", id: "work-openai" })).toBeNull();
  });

  it("reports a bad body as 400 and a missing connection as 404", async () => {
    const badKind = await authorized("/api/providers/connections", {
      method: "POST",
      body: JSON.stringify({ ...OPENAI_DRAFT, kind: "database" }),
    });
    expect(badKind.status).toBe(400);

    const missing = await authorized("/api/providers/connections/no-such", {
      method: "PATCH",
      body: JSON.stringify({ displayName: "Renamed" }),
    });
    expect(missing.status).toBe(404);

    const badFilter = await authorized(
      "/api/providers/models?capability=not-a-slot",
    );
    expect(badFilter.status).toBe(400);
  });

  it("rejects a non-slug connection id at the route before anything is written", async () => {
    const response = await authorized("/api/providers/connections", {
      method: "POST",
      body: JSON.stringify({ ...OPENAI_DRAFT, id: "Not A Slug!" }),
    });
    expect(response.status).toBe(400);

    expect(JSON.parse(await (await authorized("/api/providers/connections")).text())).toEqual([]);
    expect(credentials.size).toBe(0);
  });

  it("probes a connection through the route and reports what it found", async () => {
    // A live loopback endpoint standing in for the provider: the probe has to
    // cross the real admission, service, and net layers to reach it.
    probeRequests = [];
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      probeRequests.push(request);
      if ((request.url ?? "").startsWith("/refused")) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end("{}");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }));
    });
    probeServer = server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("The mock provider did not report a TCP port.");
    }

    const secret = "sk-route-probe-secret-77aa";
    const created = await authorized("/api/providers/connections", {
      method: "POST",
      body: JSON.stringify({
        ...OPENAI_DRAFT,
        id: "probe-target",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey: secret,
      }),
    });
    expect(created.status).toBe(201);

    const probe = await authorized("/api/providers/connections/probe-target/probe", {
      method: "POST",
    });
    expect(probe.status).toBe(200);
    const probeBody = await probe.text();
    expect(probeBody).not.toContain(secret);
    // The branching fields survive the route: an HTTP status the UI can
    // switch on and a latency it can sort by, not just the sentence.
    expect(JSON.parse(probeBody)).toMatchObject({
      ok: true,
      modelCount: 2,
      status: 200,
    });
    expect(typeof JSON.parse(probeBody).latencyMs).toBe("number");

    expect(probeRequests).toHaveLength(1);
    expect(probeRequests[0]?.url).toBe("/v1/models");
    expect(probeRequests[0]?.headers.authorization).toBe(`Bearer ${secret}`);

    // The failure branch round-trips too: a refused key is still HTTP 200
    // with ok:false, and carries the 401 the UI branches on.
    const refusedCreated = await authorized("/api/providers/connections", {
      method: "POST",
      body: JSON.stringify({
        ...OPENAI_DRAFT,
        id: "probe-refused",
        baseUrl: `http://127.0.0.1:${address.port}/refused`,
        apiKey: secret,
      }),
    });
    expect(refusedCreated.status).toBe(201);

    const refusedProbe = await authorized("/api/providers/connections/probe-refused/probe", {
      method: "POST",
    });
    expect(refusedProbe.status).toBe(200);
    const refusedBody = JSON.parse(await refusedProbe.text());
    expect(refusedBody.ok).toBe(false);
    expect(refusedBody.status).toBe(401);
    expect(typeof refusedBody.latencyMs).toBe("number");
    expect(refusedBody.failure).toMatch(/rejected the credential/i);

    // A provider-side failure is still 200 with ok:false — the probe itself
    // worked; only a missing connection is a 404.
    const unknown = await authorized("/api/providers/connections/never-existed/probe", {
      method: "POST",
    });
    expect(unknown.status).toBe(404);
  });

  it("clears a baseUrl over HTTP with null and reads it back absent", async () => {
    const created = await authorized("/api/providers/connections", {
      method: "POST",
      body: JSON.stringify(OPENAI_DRAFT),
    });
    expect(created.status).toBe(201);
    expect(JSON.parse(await created.text()).baseUrl).toBe("https://api.openai.com/v1");

    const cleared = await authorized("/api/providers/connections/work-openai", {
      method: "PATCH",
      body: JSON.stringify({ baseUrl: null }),
    });
    expect(cleared.status).toBe(200);
    const clearedText = await cleared.text();
    expect(JSON.parse(clearedText).baseUrl).toBeUndefined();

    // The read-back, not the patch's return value, is the assertion that
    // matters: a fresh GET must show the field gone.
    const listed = await authorized("/api/providers/connections");
    const connections = JSON.parse(await listed.text());
    expect(connections).toHaveLength(1);
    expect(connections[0].baseUrl).toBeUndefined();
    expect("baseUrl" in connections[0]).toBe(false);

    // And undefined-shaped patches still leave everything alone.
    const untouched = await authorized("/api/providers/connections/work-openai", {
      method: "PATCH",
      body: JSON.stringify({ displayName: "Renamed Once" }),
    });
    expect(untouched.status).toBe(200);
    expect(JSON.parse(await untouched.text()).displayName).toBe("Renamed Once");
    const relisted = JSON.parse(await (await authorized("/api/providers/connections")).text());
    expect("baseUrl" in relisted[0]).toBe(false);
  });
});
