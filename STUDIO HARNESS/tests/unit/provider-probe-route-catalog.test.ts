import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import { ProviderManagementService } from "../../src/gateway/connections/management.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { ConnectionStore } from "../../src/gateway/connections/connection-store.js";
import { ModelCatalog } from "../../src/gateway/connections/model-catalog.js";
import { createProviderRoutes } from "../../src/transport/http/routes/providers.js";
import {
  createAdmissionMiddleware,
  type AdmissionEnv,
} from "../../src/transport/http/middleware/admission.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

// The catalog resolution under test reads Pi's generated catalog, whose
// base URLs are real vendor endpoints. Mocking the module — the same two
// functions both connection-probe.ts and model-catalog.ts import — points
// the catalog at a loopback server instead, so the route, the store, the
// probe, and the network stack all run for real while the "vendor" is ours.
const catalogTarget = vi.hoisted(() => ({ port: 0 }));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  getBuiltinProviders: () => ["mock-catalog"],
  getBuiltinModels: () => [
    { id: "catalog-model-a", baseUrl: `http://127.0.0.1:${catalogTarget.port}/v1` },
    { id: "catalog-model-b", baseUrl: `http://127.0.0.1:${catalogTarget.port}/v1` },
  ],
}));

const SECRET = "sk-catalog-route-secret-e3ab";

let db: StudioDatabase;
let app: Hono<AdmissionEnv>;
let session: ReturnType<typeof createAdmissionSession>;
let server: Server | undefined;
let requests: IncomingMessage[];

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

beforeEach(async () => {
  db = openDatabase({ path: ":memory:" });
  const credentials = new InMemoryCredentialStore();
  const connections = new ConnectionStore({ db, credentials });
  session = createAdmissionSession();
  // The provider route behind the real admission middleware — the same
  // composition the scoped-scope test in provider-routes.test.ts uses, so
  // the probe crosses authentication, the service, and the net stack.
  app = new Hono<AdmissionEnv>();
  app.use("*", createAdmissionMiddleware(session.verifier));
  app.route(
    "/api/providers",
    createProviderRoutes(
      new ProviderManagementService({
        connections,
        catalog: new ModelCatalog({ db, connections }),
      }),
    ),
  );

  requests = [];
  const live = createServer((request: IncomingMessage, response: ServerResponse) => {
    requests.push(request);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }));
  });
  server = live;
  await new Promise<void>((resolve) => live.listen(0, "127.0.0.1", resolve));
  const address = live.address();
  if (address === null || typeof address === "string") {
    throw new Error("The mock catalog provider did not report a TCP port.");
  }
  catalogTarget.port = address.port;
});

afterEach(() => {
  db.close();
  if (server !== undefined) {
    server.closeAllConnections();
    server.close();
    server = undefined;
  }
});

describe("probing a catalog connection through the route", () => {
  it("probes the catalog's base URL when the connection has none", async () => {
    // The most common connection a user creates: a vendor picked from the
    // catalog, a key, and no typed URL. The probe must resolve the address
    // from the catalog and reach it.
    const created = await authorized("/api/providers/connections", {
      method: "POST",
      body: JSON.stringify({
        id: "catalog-probe",
        displayName: "Catalog Connection",
        kind: "language",
        source: "local",
        enabled: true,
        catalogProvider: "mock-catalog",
        protocol: "openai-responses",
        apiKey: SECRET,
      }),
    });
    expect(created.status).toBe(201);

    const probe = await authorized("/api/providers/connections/catalog-probe/probe", {
      method: "POST",
    });
    expect(probe.status).toBe(200);
    const body = JSON.parse(await probe.text());
    expect(body).toMatchObject({ ok: true, modelCount: 2, status: 200 });
    expect(typeof body.latencyMs).toBe("number");
    expect(body.failure).toBeUndefined();

    // The request went where the catalog said, with the stored key.
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("/v1/models");
    expect(requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it("lets an explicit baseUrl win over the catalog's", async () => {
    const created = await authorized("/api/providers/connections", {
      method: "POST",
      body: JSON.stringify({
        id: "explicit-probe",
        displayName: "Explicit Connection",
        kind: "language",
        source: "local",
        enabled: true,
        catalogProvider: "mock-catalog",
        baseUrl: `http://127.0.0.1:${catalogTarget.port}/explicit`,
        protocol: "openai-responses",
        apiKey: SECRET,
      }),
    });
    expect(created.status).toBe(201);

    const probe = await authorized("/api/providers/connections/explicit-probe/probe", {
      method: "POST",
    });
    expect(probe.status).toBe(200);
    expect(JSON.parse(await probe.text()).ok).toBe(true);

    // A user who typed a URL meant it: the probe went to the explicit
    // address, not the catalog's.
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("/explicit/models");
  });
});
