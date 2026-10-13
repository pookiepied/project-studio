import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderConfigurationError } from "../../src/contracts/models.js";
import type { AuthContext } from "../../src/admission/context.js";
import type {
  LanguageProtocol,
  MediaProtocol,
  ProviderConnection,
  ProviderConnectionDraft,
  RetrievalProtocol,
} from "../../src/contracts/providers.js";
import { ProviderManagementService } from "../../src/gateway/connections/management.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import {
  PROBE_TIMEOUT_MS,
  catalogBaseUrlFor,
  probeProviderConnection,
} from "../../src/gateway/connections/connection-probe.js";
import { ConnectionStore } from "../../src/gateway/connections/connection-store.js";
import { ModelCatalog } from "../../src/gateway/connections/model-catalog.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * The probe is exercised against real loopback servers, not a mocked client,
 * because its promise is about the wire: one request, the credential in a
 * header, and no credential in the answer. A mocked transport could not show
 * any of that. Loopback is also the destination policy's own interesting
 * case — these tests double as the proof that Ollama- and LM Studio-shaped
 * endpoints stay probeable.
 */

const AUTH: AuthContext = {
  clientId: "probe-test",
  clientType: "test",
  sessionId: "probe-test",
  scopes: [],
};

const SECRET = "sk-probe-secret-4c1f";

interface Running {
  readonly server: Server;
  readonly port: number;
  readonly requests: IncomingMessage[];
}

const running: Running[] = [];

async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<Running> {
  const requests: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    requests.push(request);
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The mock server did not report a TCP port.");
  }
  const entry: Running = { server, port: address.port, requests };
  running.push(entry);
  return entry;
}

let db: StudioDatabase;
let credentials: InMemoryCredentialStore;
let store: ConnectionStore;
let service: ProviderManagementService;

function languageDraft(baseUrl: string, apiKey?: string): ProviderConnectionDraft {
  return {
    id: "mock-provider",
    displayName: "Mock Provider",
    serves: { language: "openai-responses" },
    source: "test",
    baseUrl,
    enabled: true,
    ...(apiKey === undefined ? {} : { apiKey }),
  };
}

// One factory per kind: each kind keeps its own protocol union under
// `serves`, so a retrieval wire cannot be handed to the language factory.
function languageConnection(baseUrl: string, protocol: LanguageProtocol): ProviderConnection {
  return {
    id: "mock-provider",
    displayName: "Mock Provider",
    source: "test",
    baseUrl,
    enabled: true,
    credential: "set",
    serves: { language: protocol },
  };
}

function mediaConnection(baseUrl: string, protocol: MediaProtocol): ProviderConnection {
  return {
    id: "mock-provider",
    displayName: "Mock Provider",
    source: "test",
    baseUrl,
    enabled: true,
    credential: "set",
    serves: { media: protocol },
  };
}

function retrievalConnection(baseUrl: string, protocol: RetrievalProtocol): ProviderConnection {
  return {
    id: "mock-provider",
    displayName: "Mock Provider",
    source: "test",
    baseUrl,
    enabled: true,
    credential: "set",
    serves: { retrieval: protocol },
  };
}

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  credentials = new InMemoryCredentialStore();
  store = new ConnectionStore({ db, credentials });
  service = new ProviderManagementService({
    connections: store,
    catalog: new ModelCatalog({ db, connections: store }),
  });
});

afterEach(async () => {
  db.close();
  while (running.length > 0) {
    const entry = running.pop();
    if (entry === undefined) continue;
    entry.server.closeAllConnections();
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  }
});

describe("provider probe", () => {
  it("keeps the wait inside the task's window", () => {
    expect(PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(PROBE_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it("reports a reachable provider and counts its models", async () => {
    const target = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "a" }, { id: "b" }, { id: "c" }] }));
    });

    await store.add(languageDraft(`http://127.0.0.1:${target.port}/v1`, SECRET));
    const probe = await service.probeConnection("mock-provider", AUTH);

    expect(probe.ok).toBe(true);
    expect(probe.modelCount).toBe(3);
    expect(typeof probe.reachedAt).toBe("number");
    expect(probe.failure).toBeUndefined();
    expect(probe.status).toBe(200);
    expect(typeof probe.latencyMs).toBe("number");

    // One request, to the protocol's model list, with the stored key.
    expect(target.requests).toHaveLength(1);
    expect(target.requests[0]?.url).toBe("/v1/models");
    expect(target.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it("adopts a self-hosted endpoint's listed models on probe", async () => {
    const target = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }));
    });

    await store.add({
      ...languageDraft(`http://127.0.0.1:${target.port}/v1`, SECRET),
      serves: { language: "openai-completions" },
    });
    const probe = await service.probeConnection("mock-provider", AUTH);

    expect(probe.ok).toBe(true);
    const models = await service.listModels({ connectionId: "mock-provider" });
    expect(models.map((model) => model.modelId).sort()).toEqual(["a", "b"]);
  });

  it("never places the API key in any field of the result", async () => {
    const ok = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "a" }] }));
    });
    await store.add(languageDraft(`http://127.0.0.1:${ok.port}/v1`, SECRET));
    expect(JSON.stringify(await service.probeConnection("mock-provider", AUTH))).not.toContain(
      SECRET,
    );

    const refused = await serve((_request, response) => {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: `bad key ${SECRET}` }));
    });
    await store.remove("mock-provider");
    await store.add(languageDraft(`http://127.0.0.1:${refused.port}/v1`, SECRET));
    // The provider echoing the key back in its error body must not smuggle it
    // through the failure string either: the body is never relayed.
    expect(JSON.stringify(await service.probeConnection("mock-provider", AUTH))).not.toContain(
      SECRET,
    );
  });

  it("treats a refused key as a failure, not a throw", async () => {
    const target = await serve((_request, response) => {
      response.writeHead(401, { "content-type": "application/json" });
      response.end("{}");
    });
    await store.add(languageDraft(`http://127.0.0.1:${target.port}/v1`, SECRET));

    const probe = await service.probeConnection("mock-provider", AUTH);

    expect(probe.ok).toBe(false);
    expect(probe.failure).toMatch(/rejected the credential/i);
    expect(probe.modelCount).toBeUndefined();
    expect(probe.status).toBe(401);
    expect(typeof probe.latencyMs).toBe("number");
  });

  it("treats a dead endpoint as a failure, not a throw", async () => {
    // A port that once had a listener and now has none: the connection is
    // configured, the far end is simply not there.
    const corpse = await serve((_request, _response) => undefined);
    const port = corpse.port;
    corpse.server.closeAllConnections();
    await new Promise<void>((resolve) => corpse.server.close(() => resolve()));

    await store.add(languageDraft(`http://127.0.0.1:${port}/v1`));

    const probe = await service.probeConnection("mock-provider", AUTH);

    expect(probe.ok).toBe(false);
    expect(probe.failure).toMatch(/could not be reached/i);
    expect(probe.modelCount).toBeUndefined();
    // The request left the process and failed below HTTP, so there is a
    // latency but never a status.
    expect(probe.status).toBeUndefined();
    expect(typeof probe.latencyMs).toBe("number");
  });

  it("cuts off a hung provider at the deadline", async () => {
    const target = await serve(() => {
      // Accepts the request and never answers.
    });
    await store.add(languageDraft(`http://127.0.0.1:${target.port}/v1`));

    const probe = await probeProviderConnection(
      languageConnection(`http://127.0.0.1:${target.port}/v1`, "openai-responses"),
      undefined,
      { timeoutMs: 200 },
    );

    expect(probe.ok).toBe(false);
    expect(probe.failure).toMatch(/did not answer within 1 second/i);
    expect(probe.status).toBeUndefined();
    expect(typeof probe.latencyMs).toBe("number");
  });

  it("throws for an unknown connection id", async () => {
    await expect(service.probeConnection("no-such", AUTH)).rejects.toThrow(
      ProviderConfigurationError,
    );
  });

  it("names a missing model list without inventing a count", async () => {
    const target = await serve((_request, response) => {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not here");
    });

    const probe = await probeProviderConnection(
      languageConnection(`http://127.0.0.1:${target.port}/v1`, "openai-responses"),
      undefined,
    );

    expect(probe.ok).toBe(false);
    expect(probe.failure).toMatch(/no model list/i);
    expect(probe.modelCount).toBeUndefined();
  });

  it("leaves modelCount undefined when the endpoint answers with nothing countable", async () => {
    const plain = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("healthy");
    });

    const text = await probeProviderConnection(
      languageConnection(`http://127.0.0.1:${plain.port}/v1`, "openai-responses"),
      undefined,
    );
    expect(text.ok).toBe(true);
    expect(text.modelCount).toBeUndefined();

    // Zero models is a real answer and stays 0 — it must not be promoted to
    // undefined, nor undefined collapsed into it.
    const empty = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [] }));
    });
    const zero = await probeProviderConnection(
      languageConnection(`http://127.0.0.1:${empty.port}/v1`, "openai-responses"),
      undefined,
    );
    expect(zero.ok).toBe(true);
    expect(zero.modelCount).toBe(0);
  });

  it("speaks the anthropic protocol's headers and path", async () => {
    const target = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "claude-x" }] }));
    });

    const probe = await probeProviderConnection(
      languageConnection(`http://127.0.0.1:${target.port}`, "anthropic-messages"),
      SECRET,
    );

    expect(probe.ok).toBe(true);
    expect(probe.modelCount).toBe(1);
    expect(target.requests[0]?.url).toBe("/v1/models");
    expect(target.requests[0]?.headers["x-api-key"]).toBe(SECRET);
    expect(target.requests[0]?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(target.requests[0]?.headers.authorization).toBeUndefined();
  });

  it("speaks the google protocol's header and path", async () => {
    const target = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ name: "models/gemini-x" }] }));
    });

    const probe = await probeProviderConnection(
      languageConnection(`http://127.0.0.1:${target.port}`, "google-generative-ai"),
      SECRET,
    );

    expect(probe.ok).toBe(true);
    expect(probe.modelCount).toBe(1);
    expect(target.requests[0]?.url).toBe("/v1beta/models");
    expect(target.requests[0]?.headers["x-goog-api-key"]).toBe(SECRET);
  });

  it("does not repeat a version segment the base URL already carries", async () => {
    // Google's catalog base ends in `/v1beta`, so a probe that appended the
    // version unconditionally asked for `/v1beta/v1beta/models` and was
    // answered 404. The user saw "has no model list at the configured
    // address" for a connection whose key and address were both correct.
    const target = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ name: "models/gemini-x" }] }));
    });

    const probe = await probeProviderConnection(
      languageConnection(
        `http://127.0.0.1:${target.port}/v1beta`,
        "google-generative-ai",
      ),
      SECRET,
    );

    expect(probe.ok).toBe(true);
    expect(target.requests[0]?.url).toBe("/v1beta/models");
  });

  it("still appends the version to a base that only looks like it carries one", async () => {
    // A proxy at `/v1beta-mirror` ends with the word but not the segment, and
    // must still be asked for the versioned path.
    const target = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ name: "models/gemini-x" }] }));
    });

    const probe = await probeProviderConnection(
      languageConnection(
        `http://127.0.0.1:${target.port}/v1beta-mirror`,
        "google-generative-ai",
      ),
      SECRET,
    );

    expect(probe.ok).toBe(true);
    expect(target.requests[0]?.url).toBe("/v1beta-mirror/v1beta/models");
  });

  it("probes a retrieval connection for reachability without a model count", async () => {
    const target = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });

    const probe = await probeProviderConnection(
      retrievalConnection(`http://127.0.0.1:${target.port}`, "tavily"),
      SECRET,
    );

    expect(probe.ok).toBe(true);
    expect(probe.modelCount).toBeUndefined();
    // No model list on any retrieval wire: the cheapest question the vendor
    // answers only with a good key, Tavily's usage here.
    expect(target.requests[0]?.url).toBe("/usage");
    expect(target.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it("asks each vendor the question its API answers only with a good key", async () => {
    const target = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    const base = `http://127.0.0.1:${target.port}`;

    await probeProviderConnection(retrievalConnection(base, "exa"), SECRET);
    await probeProviderConnection(retrievalConnection(`${base}/v2`, "firecrawl"), SECRET);
    await probeProviderConnection(retrievalConnection(base, "jina"), SECRET);
    await probeProviderConnection(retrievalConnection(`${base}/res/v1`, "brave"), SECRET);
    await probeProviderConnection(mediaConnection(`${base}/v1`, "fish-audio"), SECRET);
    await probeProviderConnection(mediaConnection(base, "minimax"), SECRET);

    expect(target.requests.map((request) => request.url)).toEqual([
      "/websets/v0/websets?limit=1",
      "/v2/team/credit-usage",
      "/https://example.com",
      "/res/v1/web/search?q=studio&count=1",
      // The wallet sits beside /v1, not under it.
      "/wallet/self/api-credit",
      "/v1/files/list",
    ]);
    expect(target.requests[3]?.headers["x-subscription-token"]).toBe(SECRET);
  });

  it("reads a vendor's own way of refusing a key", async () => {
    const answers: { status: number; body: string }[] = [
      { status: 400, body: '{"detail":{"type":"authentication_error","code":"invalid_api_key"}}' },
      { status: 422, body: '{"error":{"code":"SUBSCRIPTION_TOKEN_INVALID"}}' },
      { status: 200, body: '{"base_resp":{"status_code":1004,"status_msg":"login fail"}}' },
    ];
    const target = await serve((_request, response) => {
      const answer = answers.shift() ?? { status: 500, body: "{}" };
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(answer.body);
    });
    const base = `http://127.0.0.1:${target.port}`;

    const elevenlabs = await probeProviderConnection(mediaConnection(`${base}/v1`, "elevenlabs"), SECRET);
    const brave = await probeProviderConnection(retrievalConnection(`${base}/res/v1`, "brave"), SECRET);
    const minimax = await probeProviderConnection(mediaConnection(base, "minimax"), SECRET);

    for (const probe of [elevenlabs, brave, minimax]) {
      expect(probe.ok).toBe(false);
      expect(probe.failure).toMatch(/rejected the credential/);
    }
  });

  it("reads MiniMax's zero status as the key being good", async () => {
    const target = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"files":[],"base_resp":{"status_code":0,"status_msg":"success"}}');
    });
    const probe = await probeProviderConnection(
      mediaConnection(`http://127.0.0.1:${target.port}`, "minimax"),
      SECRET,
    );
    expect(probe.ok).toBe(true);
  });

  it("reports a connection with no base URL rather than guessing one", async () => {
    const probe = await probeProviderConnection(
      { ...languageConnection("http://127.0.0.1:1/v1", "openai-responses"), baseUrl: undefined },
      undefined,
    );

    expect(probe.ok).toBe(false);
    expect(probe.failure).toMatch(/no base URL/i);
    // Never left the process: no status, and no latency to report.
    expect(probe.status).toBeUndefined();
    expect(probe.latencyMs).toBeUndefined();
  });
});

describe("catalog base URL resolution", () => {
  it("resolves a catalog provider's models to one majority URL", () => {
    const resolved = catalogBaseUrlFor("openai");

    expect(resolved).toBeDefined();
    if (resolved === undefined) return;
    expect(resolved.startsWith("https://api.openai.com")).toBe(true);
  });

  it("answers for a declared media or retrieval vendor the language catalog never names", () => {
    // These vendors are added from the library with no base URL of their
    // own, and the probe (like a generation) must still know where to go.
    expect(catalogBaseUrlFor("fal")).toBe("https://queue.fal.run");
    expect(catalogBaseUrlFor("deepgram")).toBe("https://api.deepgram.com/v1");
    expect(catalogBaseUrlFor("elevenlabs")).toBe("https://api.elevenlabs.io/v1");
    expect(catalogBaseUrlFor("brave")).toBe("https://api.search.brave.com/res/v1");
    expect(catalogBaseUrlFor("tavily")).toBe("https://api.tavily.com");
  });

  it("returns undefined for a provider whose models carry no baseUrl", () => {
    // Azure URLs are per-deployment; Pi's records rightly have none.
    expect(catalogBaseUrlFor("azure-openai-responses")).toBeUndefined();
  });

  it("returns undefined for a provider the catalog does not know", () => {
    expect(catalogBaseUrlFor("not-a-real-provider")).toBeUndefined();
  });

  it("applies the majority rule when a provider's models disagree", () => {
    // amazon-bedrock's models split across two regional endpoints; the rule
    // must pick one of the documented URLs, deterministically.
    const resolved = catalogBaseUrlFor("amazon-bedrock");

    expect([
      "https://bedrock-runtime.us-east-1.amazonaws.com",
      "https://bedrock-runtime.eu-central-1.amazonaws.com",
    ]).toContain(resolved);
    expect(catalogBaseUrlFor("amazon-bedrock")).toBe(resolved);
  });
});
