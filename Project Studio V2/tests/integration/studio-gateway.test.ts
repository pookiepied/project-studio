import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type {
  Api,
  AssistantMessageEvent,
  Context,
  Model,
} from "@earendil-works/pi-ai";

import {
  defaultModelReference,
  ModelResolutionError,
  ProviderConfigurationError,
  STUDIO_MODEL_ID,
} from "../../src/contracts/models.js";
import { createProviderBootstrapCoordinator } from "../../src/models/bootstrap.js";
import { StudioCloudModelProviderAdapter } from "../../src/models/adapters/studio-cloud-adapter.js";
import { createStaticAccessTokenProvider } from "../../src/models/studio-cloud/auth.js";
import { resolveStudioGatewayConfig } from "../../src/models/studio-cloud/config.js";
import { StudioGatewayError } from "../../src/models/studio-cloud/errors.js";

const ACCESS_TOKEN = "local-test-access-token";
const DEFAULT_MODEL = "anthropic:claude-sonnet-5";

interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

/** Scripted SSE bodies, keyed by the model the request asks for. */
const scripts = new Map<string, string>();
const requests: RecordedRequest[] = [];
let modelsStatus = 200;
let chatStatus = 200;
let chatErrorCode: string | undefined;
let holdOpen = false;
let openStreams = 0;
let closedStreams = 0;
let slowTailMs = 0;
let slowTail = "";
let holdHeaders = false;

const CATALOG = {
  object: "list",
  data: [
    {
      id: DEFAULT_MODEL,
      provider: "anthropic",
      providerModelId: "claude-sonnet-5",
      contextWindow: 200_000,
      maxTokens: 64_000,
      capabilities: {
        modalities: ["chat"],
        chat: {
          streaming: true,
          vision: true,
          tools: true,
          jsonSchema: false,
          reasoning: { supported: true },
        },
      },
    },
    {
      id: "openai:text-embedding-4",
      provider: "openai",
      providerModelId: "text-embedding-4",
      capabilities: { modalities: ["embeddings"] },
    },
  ],
};

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

let server: Server;
let baseUrl = "";

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const body = await readBody(request);
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization,
        body,
      });

      if (request.headers.authorization !== `Bearer ${ACCESS_TOKEN}`) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "no" } }));
        return;
      }

      if (request.url === "/v1/models") {
        if (modelsStatus !== 200) {
          response.writeHead(modelsStatus, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "no" } }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(CATALOG));
        return;
      }

      if (request.url === "/v1/chat/completions") {
        // Accept the connection but never send headers, so only the
        // connect/header budget can end the request.
        if (holdHeaders) return;

        if (chatStatus !== 200) {
          response.writeHead(chatStatus, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              error: {
                code: chatErrorCode ?? "INTERNAL_ERROR",
                message: "upstream detail that must not surface",
              },
            }),
          );
          return;
        }

        const requestedModel = (JSON.parse(body) as { model: string }).model;
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        });
        response.write(scripts.get(requestedModel) ?? scripts.get("*") ?? "");

        // Simulates a healthy but slow generation: headers and an opening
        // event arrive promptly, the rest lands after a long pause.
        if (slowTailMs > 0) {
          setTimeout(() => {
            response.write(slowTail);
            response.end();
          }, slowTailMs);
          return;
        }

        if (holdOpen) {
          openStreams += 1;
          response.on("close", () => {
            closedStreams += 1;
          });
          return;
        }
        response.end();
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "ROUTE_NOT_FOUND", message: "no" } }));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  scripts.clear();
  requests.length = 0;
  modelsStatus = 200;
  chatStatus = 200;
  chatErrorCode = undefined;
  holdOpen = false;
  openStreams = 0;
  closedStreams = 0;
  slowTailMs = 0;
  slowTail = "";
  holdHeaders = false;
});

function createAdapter(): StudioCloudModelProviderAdapter {
  return new StudioCloudModelProviderAdapter({
    config: resolveStudioGatewayConfig({ baseUrl, defaultModel: DEFAULT_MODEL }),
    tokenProvider: createStaticAccessTokenProvider(ACCESS_TOKEN),
  });
}

const model = { id: "default" } as Model<Api>;

function userContext(text: string): Context {
  return { messages: [{ role: "user", content: text, timestamp: Date.now() }] };
}

async function collect(
  adapter: StudioCloudModelProviderAdapter,
  context: Context = userContext("hello"),
  signal?: AbortSignal,
): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of adapter.stream(model, context, signal ? { signal } : undefined)) {
    events.push(event);
  }
  return events;
}

function textOf(events: AssistantMessageEvent[]): string {
  return events
    .filter((event) => event.type === "text_delta")
    .map((event) => event.delta)
    .join("");
}

function thinkingOf(events: AssistantMessageEvent[]): string {
  return events
    .filter((event) => event.type === "thinking_delta")
    .map((event) => event.delta)
    .join("");
}

describe("studio gateway bootstrap", () => {
  it("bootstraps the authenticated studio source and resolves the stable alias", () => {
    const coordinator = createProviderBootstrapCoordinator();
    const result = coordinator.bootstrap(
      { source: "studio-cloud" },
      {
        studioCloud: {
          config: resolveStudioGatewayConfig({ baseUrl, defaultModel: DEFAULT_MODEL }),
          tokenProvider: createStaticAccessTokenProvider(ACCESS_TOKEN),
        },
      },
    );

    expect(result.descriptor.resolvedModelId).toBe(STUDIO_MODEL_ID);
    expect(result.descriptor.source).toBe("studio-cloud");
    expect(result.registry.hasSource("studio-cloud")).toBe(true);
  });

  it("rejects unsafe base URL configuration before anything is registered", () => {
    expect(() => resolveStudioGatewayConfig({ baseUrl: "http://gateway.example.test" })).toThrow(
      ProviderConfigurationError,
    );
    expect(() => resolveStudioGatewayConfig({ baseUrl: "ftp://gateway.example.test" })).toThrow(
      ProviderConfigurationError,
    );
    expect(() =>
      resolveStudioGatewayConfig({ baseUrl: "https://user:pass@gateway.example.test" }),
    ).toThrow(/credentials/);
    expect(() =>
      resolveStudioGatewayConfig({ baseUrl: "https://gateway.example.test/?token=abc" }),
    ).toThrow(/query string/);
    expect(() => resolveStudioGatewayConfig({ baseUrl: "not-a-url" })).toThrow(
      ProviderConfigurationError,
    );
  });

  it("accepts an https gateway and normalizes the base URL", () => {
    const config = resolveStudioGatewayConfig({
      baseUrl: "https://gateway.example.test/api/",
      defaultModel: DEFAULT_MODEL,
    });
    expect(config.baseUrl).toBe("https://gateway.example.test/api");
    expect(config.origin).toBe("https://gateway.example.test");
  });

  it("requires an explicit default model rather than inventing one", () => {
    delete process.env.PROJECT_STUDIO_GATEWAY_DEFAULT_MODEL;
    expect(() => resolveStudioGatewayConfig({ baseUrl })).toThrow(
      /PROJECT_STUDIO_GATEWAY_DEFAULT_MODEL/,
    );
  });

  it("rejects an unusable timeout", () => {
    expect(() =>
      resolveStudioGatewayConfig({ baseUrl, defaultModel: DEFAULT_MODEL, requestTimeoutMs: 5 }),
    ).toThrow(ProviderConfigurationError);
  });

  it("rejects a default model that is absent from the loaded catalog", async () => {
    const adapter = new StudioCloudModelProviderAdapter({
      config: resolveStudioGatewayConfig({ baseUrl, defaultModel: "openai:not-in-catalog" }),
      tokenProvider: createStaticAccessTokenProvider(ACCESS_TOKEN),
    });
    await expect(adapter.loadCatalog()).rejects.toMatchObject({
      name: "ProviderConfigurationError",
    });
  });
});

describe("studio gateway catalog", () => {
  it("normalizes /v1/models into descriptors and capabilities", async () => {
    const adapter = createAdapter();
    const models = await adapter.loadCatalog();

    expect(requests[0]?.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(models.map((descriptor) => descriptor.resolvedModelId)).toEqual([
      "project-studio/default",
      `project-studio/${DEFAULT_MODEL}`,
      "project-studio/openai:text-embedding-4",
    ]);

    const alias = adapter.resolve(defaultModelReference("studio-cloud"));
    expect(alias.capability.toolCalling).toBe("supported");
    expect(alias.capability.reasoning).toBe("supported");
    expect(alias.capability.contextWindow).toBe(200_000);

    const embedding = adapter.resolve({
      source: "studio-cloud",
      provider: "project-studio",
      model: "openai:text-embedding-4",
    });
    expect(embedding.capability.embeddings).toBe("supported");
    expect(embedding.capability.textGeneration).toBe("unsupported");
    // Chat sub-capabilities are undescribed for a non-chat model, not denied.
    expect(embedding.capability.toolCalling).toBe("unknown");
  });

  it("resolves the alias before the catalog is loaded", () => {
    const adapter = createAdapter();
    expect(adapter.catalogLoaded).toBe(false);
    expect(adapter.resolve(defaultModelReference("studio-cloud")).resolvedModelId).toBe(
      STUDIO_MODEL_ID,
    );
  });

  it("rejects a reference for another source or provider", () => {
    const adapter = createAdapter();
    expect(() => adapter.resolve(defaultModelReference("test"))).toThrow(ModelResolutionError);
    expect(() =>
      adapter.resolve({ source: "studio-cloud", provider: "openai", model: "default" }),
    ).toThrow(ModelResolutionError);
  });

  it("surfaces a gateway failure as a typed error without the upstream body", async () => {
    modelsStatus = 500;
    const adapter = createAdapter();
    await expect(adapter.loadCatalog()).rejects.toMatchObject({
      name: "StudioGatewayError",
      kind: "internal",
    });
  });
});

describe("studio gateway streaming", () => {
  it("streams text and reasoning without duplicating compatibility events", async () => {
    scripts.set(
      DEFAULT_MODEL,
      frame("stream.started", { type: "stream.started", provider: "anthropic", model: DEFAULT_MODEL }) +
        frame("reasoning", { type: "reasoning", chunk: "think " }) +
        frame("model.reasoning.delta", { type: "model.reasoning.delta", chunk: "think " }) +
        frame("reasoning", { type: "reasoning", chunk: "harder" }) +
        frame("model.reasoning.delta", { type: "model.reasoning.delta", chunk: "harder" }) +
        frame("content", { type: "content", chunk: "Hello " }) +
        frame("model.message.delta", { type: "model.message.delta", chunk: "Hello " }) +
        frame("content", { type: "content", chunk: "world" }) +
        frame("model.message.delta", { type: "model.message.delta", chunk: "world" }) +
        frame("model.completed", { type: "model.completed", finishReason: "stop" }) +
        frame("stream.completed", { type: "stream.completed" }) +
        "data: [DONE]\n\n",
    );

    const events = await collect(createAdapter());

    expect(textOf(events)).toBe("Hello world");
    expect(thinkingOf(events)).toBe("think harder");
    expect(events.filter((event) => event.type === "text_delta")).toHaveLength(2);
    expect(events.filter((event) => event.type === "thinking_delta")).toHaveLength(2);
    expect(events.filter((event) => event.type === "start")).toHaveLength(1);

    const done = events.at(-1);
    expect(done?.type).toBe("done");
    expect(done?.type === "done" && done.reason).toBe("stop");
    expect(done?.type === "done" && done.message.content).toEqual([
      { type: "thinking", thinking: "think harder" },
      { type: "text", text: "Hello world" },
    ]);
  });

  it("emits compatibility-only output when the gateway sends no canonical twin", async () => {
    scripts.set(
      DEFAULT_MODEL,
      frame("stream.started", { type: "stream.started" }) +
        frame("content", { type: "content", chunk: "only-compat" }) +
        frame("stream.completed", { type: "stream.completed" }) +
        "data: [DONE]\n\n",
    );

    expect(textOf(await collect(createAdapter()))).toBe("only-compat");
  });

  it("preserves every tool call, its id, and its order", async () => {
    const first = { id: "call-1", type: "function", function: { name: "alpha", arguments: '{"a":1}' } };
    const second = { id: "call-2", type: "function", function: { name: "beta", arguments: '{"b":2}' } };

    scripts.set(
      DEFAULT_MODEL,
      frame("stream.started", { type: "stream.started" }) +
        frame("tool_call", { type: "tool_call", call: first }) +
        frame("model.tool_call.completed", { type: "model.tool_call.completed", call: first }) +
        frame("tool_call", { type: "tool_call", call: second }) +
        frame("model.tool_call.completed", { type: "model.tool_call.completed", call: second }) +
        // Terminal aggregate repeats both calls; it must not duplicate them.
        frame("tool_calls", { type: "tool_calls", calls: [first, second] }) +
        frame("model.completed", { type: "model.completed", finishReason: "tool-calls" }) +
        frame("stream.completed", { type: "stream.completed" }) +
        "data: [DONE]\n\n",
    );

    const events = await collect(createAdapter());
    const ends = events.filter((event) => event.type === "toolcall_end");

    expect(ends).toHaveLength(2);
    expect(ends.map((event) => event.type === "toolcall_end" && event.toolCall.id)).toEqual([
      "call-1",
      "call-2",
    ]);
    expect(ends[0]?.type === "toolcall_end" && ends[0].toolCall.arguments).toEqual({ a: 1 });

    const done = events.at(-1);
    expect(done?.type === "done" && done.reason).toBe("toolUse");
    expect(done?.type === "done" && done.message.content).toHaveLength(2);
  });

  it("preserves usage and the finish reason", async () => {
    const usage = {
      prompt_tokens: 120,
      completion_tokens: 34,
      total_tokens: 154,
      cache_read_input_tokens: 100,
      reasoning_tokens: 12,
    };

    scripts.set(
      DEFAULT_MODEL,
      frame("stream.started", { type: "stream.started" }) +
        frame("content", { type: "content", chunk: "hi" }) +
        frame("model.message.delta", { type: "model.message.delta", chunk: "hi" }) +
        frame("usage", { type: "usage", data: usage }) +
        frame("model.usage", { type: "model.usage", data: usage }) +
        frame("model.completed", { type: "model.completed", finishReason: "length" }) +
        frame("stream.completed", { type: "stream.completed" }) +
        "data: [DONE]\n\n",
    );

    const done = (await collect(createAdapter())).at(-1);
    expect(done?.type === "done" && done.reason).toBe("length");
    expect(done?.type === "done" && done.message.usage).toMatchObject({
      input: 120,
      output: 34,
      totalTokens: 154,
      cacheRead: 100,
      reasoning: 12,
    });
  });

  it("turns a terminal stream error into a safe typed Pi error", async () => {
    scripts.set(
      DEFAULT_MODEL,
      frame("stream.started", { type: "stream.started" }) +
        frame("stream.error", {
          type: "stream.error",
          error: { code: "PROVIDER_RATE_LIMITED", message: "upstream detail that must not surface" },
        }),
    );

    const events = await collect(createAdapter());
    const last = events.at(-1);

    expect(last?.type).toBe("error");
    expect(last?.type === "error" && last.reason).toBe("error");
    expect(last?.type === "error" && last.error.errorMessage).toBe(
      "The Studio gateway is rate limiting requests.",
    );
    expect(JSON.stringify(events)).not.toContain("upstream detail that must not surface");
  });

  it("turns an HTTP failure into a safe typed Pi error", async () => {
    chatStatus = 403;
    chatErrorCode = "FORBIDDEN";

    const events = await collect(createAdapter());
    const last = events.at(-1);

    expect(last?.type === "error" && last.error.errorMessage).toBe(
      "The access token is not permitted to perform this request.",
    );
    expect(JSON.stringify(events)).not.toContain("upstream detail that must not surface");
  });

  it("closes the upstream stream when the caller cancels", async () => {
    holdOpen = true;
    scripts.set(
      DEFAULT_MODEL,
      frame("stream.started", { type: "stream.started" }) +
        frame("model.message.delta", { type: "model.message.delta", chunk: "partial" }),
    );

    const controller = new AbortController();
    const adapter = createAdapter();
    const events: AssistantMessageEvent[] = [];

    for await (const event of adapter.stream(model, userContext("hello"), {
      signal: controller.signal,
    })) {
      events.push(event);
      if (event.type === "text_delta") controller.abort();
    }

    const last = events.at(-1);
    expect(last?.type).toBe("error");
    expect(last?.type === "error" && last.reason).toBe("aborted");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(openStreams).toBe(1);
    expect(closedStreams).toBe(1);
  });

  it("sends the transcript, tools, and tool results the gateway needs to continue", async () => {
    scripts.set(
      DEFAULT_MODEL,
      frame("stream.started", { type: "stream.started" }) +
        frame("model.message.delta", { type: "model.message.delta", chunk: "done" }) +
        frame("stream.completed", { type: "stream.completed" }) +
        "data: [DONE]\n\n",
    );

    const context: Context = {
      systemPrompt: "be helpful",
      tools: [
        {
          name: "workspace_summary",
          description: "summarize",
          parameters: { type: "object", properties: {} } as never,
        },
      ],
      messages: [
        { role: "user", content: "summarize", timestamp: 1 },
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "call-1", name: "workspace_summary", arguments: { workspace: "v2" } },
          ],
          api: "project-studio-gateway",
          provider: "project-studio",
          model: "default",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse",
          timestamp: 2,
        },
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "workspace_summary",
          content: [{ type: "text", text: "ready" }],
          isError: false,
          timestamp: 3,
        },
      ],
    };

    await collect(createAdapter(), context);

    const sent = JSON.parse(requests.at(-1)?.body ?? "{}") as {
      model: string;
      messages: Array<Record<string, unknown>>;
      tools: Array<{ function: { name: string } }>;
    };

    expect(sent.model).toBe(DEFAULT_MODEL);
    expect(sent.tools[0]?.function.name).toBe("workspace_summary");
    expect(sent.messages[0]).toMatchObject({ role: "system", content: "be helpful" });
    expect(sent.messages[2]).toMatchObject({
      role: "assistant",
      toolCalls: [{ id: "call-1", name: "workspace_summary", arguments: '{"workspace":"v2"}' }],
    });
    expect(sent.messages[3]).toMatchObject({
      role: "tool",
      toolCallId: "call-1",
      toolName: "workspace_summary",
      content: "ready",
    });
  });
});

describe("credential handling", () => {
  it("sends the token only to the configured gateway origin", async () => {
    const adapter = createAdapter();
    await adapter.loadCatalog();

    for (const request of requests) {
      expect(request.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    }
  });

  it("keeps the token out of descriptors, errors, and stream events", async () => {
    chatStatus = 401;
    chatErrorCode = "UNAUTHENTICATED";

    const adapter = createAdapter();
    const events = await collect(adapter);
    const descriptors = adapter.listModels();

    expect(JSON.stringify(events)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(descriptors)).not.toContain(ACCESS_TOKEN);

    const error = new StudioGatewayError("authentication", { status: 401 });
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(ACCESS_TOKEN);
  });

  it("rejects a token that is not a valid Authorization header value", () => {
    expect(() => createStaticAccessTokenProvider("has space")).toThrow(StudioGatewayError);
    expect(() => createStaticAccessTokenProvider("")).toThrow(StudioGatewayError);
  });
});

describe("request timeout scope", () => {
  it("does not truncate a healthy generation that streams longer than the timeout", async () => {
    // Headers plus an opening event arrive at once; the rest lands after a
    // pause longer than the configured timeout. The timeout guards connect and
    // headers only, so this must still complete.
    scripts.set(
      DEFAULT_MODEL,
      frame("stream.started", { type: "stream.started" }) +
        frame("model.message.delta", { type: "model.message.delta", chunk: "slow " }),
    );
    slowTail =
      frame("model.message.delta", { type: "model.message.delta", chunk: "but complete" }) +
      frame("model.completed", { type: "model.completed", finishReason: "stop" }) +
      frame("stream.completed", { type: "stream.completed" }) +
      "data: [DONE]\n\n";
    // Deliberately longer than the configured timeout below.
    slowTailMs = 1_800;

    const adapter = new StudioCloudModelProviderAdapter({
      config: resolveStudioGatewayConfig({
        baseUrl,
        defaultModel: DEFAULT_MODEL,
        requestTimeoutMs: 1_000,
      }),
      tokenProvider: createStaticAccessTokenProvider(ACCESS_TOKEN),
    });

    const events = await collect(adapter);
    expect(textOf(events)).toBe("slow but complete");

    const done = events.at(-1);
    expect(done?.type).toBe("done");
    expect(done?.type === "done" && done.reason).toBe("stop");
  }, 15_000);

  it("still fails as a timeout when the gateway never sends headers", async () => {
    holdHeaders = true;

    const adapter = new StudioCloudModelProviderAdapter({
      config: resolveStudioGatewayConfig({
        baseUrl,
        defaultModel: DEFAULT_MODEL,
        requestTimeoutMs: 1_000,
      }),
      tokenProvider: createStaticAccessTokenProvider(ACCESS_TOKEN),
    });

    const last = (await collect(adapter)).at(-1);
    expect(last?.type).toBe("error");
    expect(last?.type === "error" && last.error.errorMessage).toBe(
      "The Studio gateway did not respond in time.",
    );
  }, 15_000);
});

describe("bootstrap exposes the catalog service", () => {
  it("reaches loadCatalog through the configured registry", async () => {
    const coordinator = createProviderBootstrapCoordinator();
    const result = coordinator.bootstrap(
      { source: "studio-cloud" },
      {
        studioCloud: {
          config: resolveStudioGatewayConfig({ baseUrl, defaultModel: DEFAULT_MODEL }),
          tokenProvider: createStaticAccessTokenProvider(ACCESS_TOKEN),
        },
      },
    );

    const adapter = result.registry.getAdapter("studio-cloud");
    expect(adapter).toBeInstanceOf(StudioCloudModelProviderAdapter);

    const models = await (adapter as StudioCloudModelProviderAdapter).loadCatalog();
    expect(models.length).toBeGreaterThan(1);
  });
});
