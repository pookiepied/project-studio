import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Api, Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../../src/admission/context.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { ConnectionStore } from "../../src/gateway/connections/connection-store.js";
import { ModelCatalog } from "../../src/gateway/connections/model-catalog.js";
import { ProviderManagementService } from "../../src/gateway/connections/management.js";
import {
  LOCAL_ALIAS_API,
  type LocalModelProviderAdapter,
} from "../../src/gateway/language/adapters/local-adapter.js";
import { createProviderBootstrapCoordinator } from "../../src/gateway/language/bootstrap.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * A keyless, IPv4-only OpenAI-compatible server reached as `localhost` - the
 * shape of 9router, and of most local dev gateways - added through the same
 * management service the settings screen uses, while the harness is running.
 *
 * Two failures used to meet here. The probe pinned the first address the name
 * resolved to; Windows answers `localhost` with `::1` first, the server
 * listens on IPv4 only, and the probe said "could not be reached". And the
 * language runtime was built once at boot, so a model added afterwards was
 * admitted by the catalog and then refused by the runtime until a restart.
 *
 * The resolver is forced to answer IPv6 first so the first failure reproduces
 * on every machine, not only on the ones whose resolver happens to.
 */
const resolved = vi.hoisted(() => ({ ipv6First: false }));

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return {
    ...actual,
    lookup: async (host: string, options: unknown) => {
      if (resolved.ipv6First && host === "localhost") {
        return [
          { address: "::1", family: 6 },
          { address: "127.0.0.1", family: 4 },
        ];
      }
      return actual.lookup(host, options as never);
    },
  };
});

const MODEL_ID = "oc/glm-5.3-flash-free(none)";
const LISTED_ID = "ocg/glm-5.3-flash";
const VISION_ID = "gemini/gemini-3.8-flash";

const AUTH: AuthContext = {
  clientId: "local-provider-test",
  clientType: "test",
  sessionId: "local-provider-test",
  scopes: [],
};

interface FakeRouter {
  readonly server: Server;
  readonly port: number;
  readonly requests: { path: string; authorization: string | undefined; body: unknown }[];
}

function sse(frames: readonly unknown[]): string {
  // 9router repeats the terminator; a strict reader must tolerate that.
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\ndata: [DONE]\n\n";
}

async function startFakeRouter(): Promise<FakeRouter> {
  const requests: FakeRouter["requests"] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      requests.push({
        path: request.url ?? "",
        authorization: request.headers.authorization,
        body: raw === "" ? undefined : JSON.parse(raw),
      });

      if (request.method === "GET" && request.url === "/v1/models") {
        // 9router's shape: extra fields, and the list does not name every id
        // the server accepts (the `oc/` ids are routable but unlisted).
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          object: "list",
          data: [{
            id: LISTED_ID, object: "model", owned_by: "ocg",
            capabilities: { tools: true, reasoning: true, contextWindow: 200_000 },
            context_length: 200_000, max_completion_tokens: 65_536,
          }, {
            id: VISION_ID, object: "model", owned_by: "gemini",
            capabilities: { vision: true, tools: true, reasoning: true, contextWindow: 1_048_576, maxOutput: 65_536 },
            context_length: 1_048_576, max_completion_tokens: 65_536,
          }],
        }));
        return;
      }
      if (request.method === "POST" && request.url === "/v1/chat/completions") {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        // The answer names the upstream model, not the id that was asked for.
        const base = { id: "chatcmpl-fake", object: "chat.completion.chunk", created: 1, model: "glm-5.3-flash-free" };
        response.end(sse([
          { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" } }], usage: null },
          { ...base, choices: [{ index: 0, delta: { reasoning_content: "Thinking." } }], usage: null },
          { ...base, choices: [{ index: 0, delta: { content: "pong" } }], usage: null },
          { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: null },
          { ...base, choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
        ]));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
    })();
  });
  // IPv4 only, as 9router binds.
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port, requests };
}

function aliasFor(id: string): Model<Api> {
  return {
    id, name: id, api: LOCAL_ALIAS_API, provider: "project-studio", baseUrl: "",
    reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000, maxTokens: 8_192,
  };
}

/** Sends one picture to a model and returns the request the router received. */
async function pictureTo(adapter: LocalModelProviderAdapter, id: string): Promise<string> {
  const stream = adapter.stream(aliasFor(id), {
    messages: [{ role: "user", content: [
      { type: "text", text: "What is on this screen?" },
      { type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", mimeType: "image/png" },
    ], timestamp: Date.now() }],
  });
  for await (const event of stream) void event;
  await stream.result();
  const chats = router.requests.filter((request) => request.path === "/v1/chat/completions");
  return JSON.stringify(chats.at(-1)?.body);
}

async function textOf(adapter: LocalModelProviderAdapter, alias: Model<Api>): Promise<string> {
  const stream = adapter.stream(alias, {
    messages: [{ role: "user", content: "Reply with pong.", timestamp: Date.now() }],
  });
  let text = "";
  for await (const event of stream) {
    if (event.type === "text_delta") text += event.delta;
  }
  const result = await stream.result();
  if (result.stopReason === "error") throw new Error(result.errorMessage ?? "provider error");
  return text;
}

let router: FakeRouter;
let directory: string;
let database: StudioDatabase;
let previousHome: string | undefined;

beforeEach(async () => {
  resolved.ipv6First = true;
  router = await startFakeRouter();
  // Isolated state: never the user's Studio home.
  directory = await mkdtemp(join(tmpdir(), "studio-local-provider-"));
  previousHome = process.env.PROJECT_STUDIO_HOME;
  process.env.PROJECT_STUDIO_HOME = join(directory, "home");
  database = openDatabase({ path: join(directory, "studio.db") });
});

afterEach(async () => {
  resolved.ipv6First = false;
  database.close();
  if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
  else process.env.PROJECT_STUDIO_HOME = previousHome;
  router.server.closeAllConnections();
  await new Promise<void>((resolve) => router.server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

function compose(options: { readonly reload: boolean }) {
  const credentials = new InMemoryCredentialStore();
  const connections = new ConnectionStore({ db: database, credentials });
  const catalog = new ModelCatalog({ db: database, connections, liveListings: false });
  // Booted before the provider exists, exactly as a running app is.
  const coordinator = createProviderBootstrapCoordinator();
  const boot = coordinator.bootstrap({ source: "local" }, { database, local: { credentials } });
  const providers = new ProviderManagementService({
    connections,
    catalog,
    ...(options.reload ? { onLanguageSettingsChanged: () => coordinator.reloadFromSettings() } : {}),
  });
  const adapter = boot.registry.getAdapter("local") as LocalModelProviderAdapter;
  return { providers, catalog, adapter, coordinator, credentials };
}

async function addRouter(providers: ProviderManagementService): Promise<void> {
  await providers.addConnection({
    id: "9router",
    displayName: "9router",
    source: "local",
    enabled: true,
    baseUrl: `http://localhost:${router.port}/v1`,
    serves: { language: "openai-completions" },
  }, AUTH);
}

describe("a keyless local OpenAI-compatible provider added while the harness runs", () => {
  it("probes as reachable over IPv4 when localhost resolves to ::1 first, without sending a credential", async () => {
    const { providers } = compose({ reload: true });
    await addRouter(providers);

    const probe = await providers.probeConnection("9router", AUTH);

    expect(probe).toMatchObject({ ok: true, status: 200, modelCount: 2 });
    expect(router.requests.map((request) => request.path)).toEqual(["/v1/models"]);
    // No key is configured, so none - not an empty bearer - is sent.
    expect(router.requests[0]?.authorization).toBeUndefined();
  });

  it("answers a turn on a hand-added model whose id has slashes and parentheses", async () => {
    const { providers, catalog, adapter } = compose({ reload: true });
    await addRouter(providers);
    await providers.probeConnection("9router", AUTH);
    await providers.addManualModel("9router", { modelId: MODEL_ID, displayName: MODEL_ID }, AUTH);

    expect(await catalog.servedModelReferences()).toContain(`9router/${MODEL_ID}`);
    expect(adapter.resolve({ source: "local", provider: "project-studio", model: `9router/${MODEL_ID}` }))
      .toMatchObject({ resolvedModelId: `project-studio/9router/${MODEL_ID}` });

    expect(await textOf(adapter, aliasFor(`9router/${MODEL_ID}`))).toBe("pong");
    const chat = router.requests.find((request) => request.path === "/v1/chat/completions");
    // The id reaches the wire exactly as typed - not split, not encoded.
    expect(chat?.body).toMatchObject({ model: MODEL_ID, stream: true });
  });

  it("routes the stable alias once the new model is chosen as the text default", async () => {
    const { providers, adapter } = compose({ reload: true });
    await addRouter(providers);
    await providers.addManualModel("9router", { modelId: MODEL_ID, displayName: MODEL_ID }, AUTH);
    await providers.setDefault("textGeneration", { connectionId: "9router", modelId: MODEL_ID }, AUTH);

    expect(adapter.assertTargetResolvable()).toMatchObject({ provider: "9router", id: MODEL_ID });
    expect(await textOf(adapter, aliasFor("default"))).toBe("pong");
  });

  it("adopts a listed id on probe and makes it routable at once", async () => {
    const { providers, adapter } = compose({ reload: true });
    await addRouter(providers);
    await providers.probeConnection("9router", AUTH);

    expect(await textOf(adapter, aliasFor(`9router/${LISTED_ID}`))).toBe("pong");
  });

  it("lets a listed vision model see pictures, and adopts the limits the list states", async () => {
    // Before, every adopted or hand-added model of a self-hosted endpoint was
    // registered text-only, and Pi replaced each picture with a placeholder:
    // a vision model behind 9router never saw a screenshot or attachment.
    const { providers, adapter } = compose({ reload: true });
    await addRouter(providers);
    await providers.probeConnection("9router", AUTH);

    const rows = await providers.listModels({ connectionId: "9router" });
    expect(rows.find((row) => row.modelId === VISION_ID)?.capability).toMatchObject({
      vision: "supported", toolCalling: "supported", reasoning: "supported", contextWindow: 1_048_576, maxOutputTokens: 65_536,
    });
    expect(rows.find((row) => row.modelId === LISTED_ID)?.capability).toMatchObject({
      vision: "unknown", contextWindow: 200_000, maxOutputTokens: 65_536,
    });

    expect(await pictureTo(adapter, `9router/${VISION_ID}`)).toContain("data:image/png;base64,");
    // A model nobody said can see keeps the placeholder: no bytes are sent.
    expect(await pictureTo(adapter, `9router/${LISTED_ID}`)).not.toContain("data:image/png;base64,");
  });

  it("sends only the newest pictures of a long screenshot run, so the provider does not refuse the request", async () => {
    // A computer-use run resends every earlier screenshot on every turn; past
    // about thirty the providers refused the request and the run died.
    const { providers, adapter } = compose({ reload: true });
    await addRouter(providers);
    await providers.probeConnection("9router", AUTH);
    const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const content = Array.from({ length: 34 }, () => ({ type: "image" as const, data: pixel, mimeType: "image/png" }));
    const stream = adapter.stream(aliasFor(`9router/${VISION_ID}`), {
      messages: [{ role: "user", content: [{ type: "text", text: "Where is the button?" }, ...content], timestamp: Date.now() }],
    });
    for await (const event of stream) void event;
    await stream.result();
    const body = JSON.stringify(router.requests.filter((request) => request.path === "/v1/chat/completions").at(-1)?.body);
    // 34 is 14 over the twenty-picture window; the cut moves in tens, so 20 go.
    expect(body.split("data:image/png;base64,")).toHaveLength(15);
    expect(body.split("left out of this request")).toHaveLength(21);
  });

  it("sends pictures to a hand-added model declared to read them", async () => {
    const { providers, adapter } = compose({ reload: true });
    await addRouter(providers);
    await providers.addManualModel("9router", { modelId: MODEL_ID, displayName: MODEL_ID, capability: { vision: "supported" } }, AUTH);
    expect(await pictureTo(adapter, `9router/${MODEL_ID}`)).toContain("data:image/png;base64,");
  });

  it("fills only what an existing row leaves unknown when a later probe states it", async () => {
    const { providers } = compose({ reload: true });
    await addRouter(providers);
    // Said by a person before the list was read: never overwritten by it.
    await providers.addManualModel("9router", { modelId: VISION_ID, displayName: "Gemini", capability: { vision: "unsupported", contextWindow: 32_000 } }, AUTH);
    await providers.probeConnection("9router", AUTH);

    const row = (await providers.listModels({ connectionId: "9router" })).find((model) => model.modelId === VISION_ID);
    expect(row?.displayName).toBe("Gemini");
    expect(row?.capability).toMatchObject({ vision: "unsupported", contextWindow: 32_000, maxOutputTokens: 65_536, toolCalling: "supported" });
  });

  it("stops routing a model once it is removed", async () => {
    const { providers, adapter } = compose({ reload: true });
    await addRouter(providers);
    await providers.addManualModel("9router", { modelId: MODEL_ID, displayName: MODEL_ID }, AUTH);
    await providers.removeModel("9router", MODEL_ID, AUTH);

    expect(() => adapter.resolve({ source: "local", provider: "project-studio", model: `9router/${MODEL_ID}` }))
      .toThrow(/Unknown model/);
  });

  it("without the settings hook the boot-time runtime cannot route the new model (the old failure)", async () => {
    const { providers, catalog, adapter } = compose({ reload: false });
    await addRouter(providers);
    await providers.addManualModel("9router", { modelId: MODEL_ID, displayName: MODEL_ID }, AUTH);

    // Admitted by the catalog, refused by the runtime: the mismatch the hook closes.
    expect(await catalog.servedModelReferences()).toContain(`9router/${MODEL_ID}`);
    await expect(textOf(adapter, aliasFor(`9router/${MODEL_ID}`))).rejects.toThrow(/not available/);
  });

  it("keeps the settings write when the runtime reload fails", async () => {
    const credentials = new InMemoryCredentialStore();
    const connections = new ConnectionStore({ db: database, credentials });
    const catalog = new ModelCatalog({ db: database, connections, liveListings: false });
    const providers = new ProviderManagementService({
      connections,
      catalog,
      onLanguageSettingsChanged: () => {
        throw new Error("reload failed");
      },
    });

    await addRouter(providers);
    const model = await providers.addManualModel("9router", { modelId: MODEL_ID, displayName: MODEL_ID }, AUTH);

    expect(model.modelId).toBe(MODEL_ID);
    expect((await providers.listModels({ connectionId: "9router" })).map((row) => row.modelId)).toContain(MODEL_ID);
  });
});
