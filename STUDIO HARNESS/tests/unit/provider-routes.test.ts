import { Hono } from "hono";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { McpAdministration } from "../../src/application/mcp-management.js";
import { ProviderManagementService } from "../../src/application/provider-management.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { ConnectionStore } from "../../src/providers/connection-store.js";
import { ModelCatalog } from "../../src/providers/model-catalog.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";
import { createProviderRoutes } from "../../src/transport/http/routes/providers.js";
import {
  createAdmissionMiddleware,
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
    approvals: { list: () => [] } as unknown as PermissionApprovalBroker,
    admission: session.verifier,
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
    expect(await credentials.get({ scope: "provider", id: "work-openai" })).toBeNull();
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

  it("probes a connection through the route and reports what it found", async () => {
    // A live loopback endpoint standing in for the provider: the probe has to
    // cross the real admission, service, and net layers to reach it.
    probeRequests = [];
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      probeRequests.push(request);
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
    expect(JSON.parse(probeBody)).toMatchObject({ ok: true, modelCount: 2 });

    expect(probeRequests).toHaveLength(1);
    expect(probeRequests[0]?.url).toBe("/v1/models");
    expect(probeRequests[0]?.headers.authorization).toBe(`Bearer ${secret}`);

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
