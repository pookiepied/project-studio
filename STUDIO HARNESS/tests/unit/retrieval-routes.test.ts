import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { RetrievalManagementService } from "../../src/application/retrieval-management.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { RetrievalSettingsStore } from "../../src/gateway/retrieval/settings.js";
import { createRetrievalRoutes } from "../../src/transport/http/routes/retrieval.js";
import {
  createAdmissionMiddleware,
  type AdmissionEnv,
} from "../../src/transport/http/middleware/admission.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * The retrieval settings surface: HTTP over storage that already exists,
 * with the tool path untouched. Each test that writes through the route also
 * reads the store `RetrievalService` itself reads, because the whole point
 * of the surface is that a key set here is the key `web_search` presents.
 *
 * The one rule that cannot bend: a request body may carry the key, and no
 * response body may ever contain one.
 */

const SECRET = "sk-retrieval-route-secret-4c19";

let db: StudioDatabase;
let credentials: InMemoryCredentialStore;
let settings: RetrievalSettingsStore;
let app: Hono<AdmissionEnv>;
let session: ReturnType<typeof createAdmissionSession>;

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
  settings = new RetrievalSettingsStore(db);
  session = createAdmissionSession();

  app = new Hono<AdmissionEnv>();
  app.use("*", createAdmissionMiddleware(session.verifier));
  app.route(
    "/api/providers/retrieval",
    createRetrievalRoutes(
      new RetrievalManagementService({ settings, credentials }),
    ),
  );
});

describe("retrieval routes", () => {
  it("requires the provider-management scope", async () => {
    const limited = createAdmissionSession({
      scopes: [ADMISSION_SCOPES.AGENT_RUN],
    });
    const scoped = new Hono<AdmissionEnv>();
    scoped.use("*", createAdmissionMiddleware(limited.verifier));
    scoped.route(
      "/api/providers/retrieval",
      createRetrievalRoutes(
        new RetrievalManagementService({ settings, credentials }),
      ),
    );

    const response = await scoped.request("http://harness.test/api/providers/retrieval", {
      headers: { authorization: `Bearer ${limited.credential}` },
    });
    expect(response.status).toBe(403);
    const body = JSON.parse(await response.text());
    expect(body.code).toBe("admission.scope_required");
    expect(body.scope).toBe(ADMISSION_SCOPES.PROVIDER_MANAGEMENT);
  });

  it("lists both capabilities, their providers, and the slot defaults", async () => {
    const response = await authorized("/api/providers/retrieval");
    expect(response.status).toBe(200);

    const body = JSON.parse(await response.text());
    expect(body.search.capability).toBe("search");
    expect(body.search.providers.map((p: { id: string }) => p.id)).toEqual([
      "tavily",
      "brave",
      "exa",
    ]);
    expect(body.search.providers.every((p: { credential: string }) => p.credential === "absent")).toBe(true);
    expect(body.search.primary).toBe("tavily");
    expect(body.search.fallback).toBeUndefined();

    expect(body.reader.capability).toBe("reader");
    expect(body.reader.providers.map((p: { id: string }) => p.id)).toEqual([
      "jina",
      "firecrawl",
    ]);
    expect(body.reader.primary).toBe("jina");
    expect(body.reader.fallback).toBeUndefined();

    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("sets a key where the tool path reads it, and never echoes it", async () => {
    const set = await authorized("/api/providers/retrieval/providers/tavily/key", {
      method: "PUT",
      body: JSON.stringify({ apiKey: SECRET }),
    });
    expect(set.status).toBe(204);
    expect(await set.text()).toBe("");

    // The tool path's own lookup: RetrievalService reads exactly this
    // credential key when it builds the search slots.
    await expect(credentials.get({ scope: "provider", id: "tavily" })).resolves.toBe(SECRET);

    const response = await authorized("/api/providers/retrieval");
    const body = JSON.parse(await response.text());
    const tavily = body.search.providers.find(
      (p: { id: string }) => p.id === "tavily",
    );
    expect(tavily.credential).toBe("set");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("clears a key", async () => {
    await authorized("/api/providers/retrieval/providers/jina/key", {
      method: "PUT",
      body: JSON.stringify({ apiKey: SECRET }),
    });

    const cleared = await authorized("/api/providers/retrieval/providers/jina/key", {
      method: "DELETE",
    });
    expect(cleared.status).toBe(204);

    await expect(credentials.get({ scope: "provider", id: "jina" })).resolves.toBeNull();
    const body = JSON.parse(
      await (await authorized("/api/providers/retrieval")).text(),
    );
    const jina = body.reader.providers.find((p: { id: string }) => p.id === "jina");
    expect(jina.credential).toBe("absent");
  });

  it("sets and clears a fallback slot in the store the tool path reads", async () => {
    const set = await authorized("/api/providers/retrieval/slots/search/fallback", {
      method: "PUT",
      body: JSON.stringify({ providerId: "brave" }),
    });
    expect(set.status).toBe(204);

    // What web_search will resolve, not what the route said back.
    expect(settings.read("search")).toEqual({ primary: "tavily", fallback: "brave" });

    const body = JSON.parse(
      await (await authorized("/api/providers/retrieval")).text(),
    );
    expect(body.search.fallback).toBe("brave");

    const cleared = await authorized("/api/providers/retrieval/slots/search/fallback", {
      method: "DELETE",
    });
    expect(cleared.status).toBe(204);
    expect(settings.read("search").fallback).toBeUndefined();
  });

  it("moves a primary slot and restores the default by clearing it", async () => {
    const set = await authorized("/api/providers/retrieval/slots/reader/primary", {
      method: "PUT",
      body: JSON.stringify({ providerId: "firecrawl" }),
    });
    expect(set.status).toBe(204);
    expect(settings.read("reader")).toEqual({ primary: "firecrawl", fallback: undefined });

    const cleared = await authorized("/api/providers/retrieval/slots/reader/primary", {
      method: "DELETE",
    });
    expect(cleared.status).toBe(204);
    // An empty slot is the registry default again, the same semantics the
    // settings store has always had.
    expect(settings.read("reader").primary).toBe("jina");
  });

  it("refuses a provider from the other capability in a slot", async () => {
    const response = await authorized("/api/providers/retrieval/slots/search/fallback", {
      method: "PUT",
      body: JSON.stringify({ providerId: "jina" }),
    });
    expect(response.status).toBe(400);
    const body = JSON.parse(await response.text());
    expect(body.error).toMatch(/not a search provider/i);
    expect(settings.read("search").fallback).toBeUndefined();
  });

  it("refuses an unknown provider for a key", async () => {
    const response = await authorized("/api/providers/retrieval/providers/not-a-provider/key", {
      method: "PUT",
      body: JSON.stringify({ apiKey: SECRET }),
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(await response.text()).error).toMatch(/not a retrieval provider/i);
    expect(JSON.stringify(await credentials.get({ scope: "provider", id: "not-a-provider" }))).not.toContain(SECRET);
  });

  it("refuses a malformed capability, slot, or body", async () => {
    const badCapability = await authorized("/api/providers/retrieval/slots/citation/fallback", {
      method: "PUT",
      body: JSON.stringify({ providerId: "brave" }),
    });
    expect(badCapability.status).toBe(400);

    const badSlot = await authorized("/api/providers/retrieval/slots/search/tertiary", {
      method: "PUT",
      body: JSON.stringify({ providerId: "brave" }),
    });
    expect(badSlot.status).toBe(400);

    const badBody = await authorized("/api/providers/retrieval/providers/tavily/key", {
      method: "PUT",
      body: JSON.stringify({ apiKey: "" }),
    });
    expect(badBody.status).toBe(400);
  });
});
