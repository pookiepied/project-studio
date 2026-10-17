import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type { Api, Model } from "@earendil-works/pi-ai";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioRuntime } from "../../src/application/studio-runtime.js";
import { openDatabase } from "../../src/storage/database.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { LocalModelProviderAdapter } from "../../src/gateway/language/adapters/local-adapter.js";
import { resolveLocalModelConfig } from "../../src/gateway/language/local/config.js";
import { PiCredentialStore } from "../../src/gateway/language/local/credential-bridge.js";
import {
  createLocalRuntime,
  LOCAL_PLACEHOLDER_KEY,
  type LocalRuntime,
} from "../../src/gateway/language/local/runtime.js";
import { LOCAL_ALIAS_API } from "../../src/gateway/language/adapters/local-adapter.js";
import { defaultModelReference } from "../../src/contracts/models.js";

/**
 * Proves local BYOK end to end without a real provider account: a user-declared
 * OpenAI-compatible provider, a key stored through the credential bridge, and a
 * mock server standing in for Ollama, LM Studio, or any proxy.
 *
 * The assertion that matters is that the stored key arrives as an Authorization
 * header on the wire, having travelled keychain -> Pi auth resolution ->
 * provider request without the adapter ever handling it.
 */

interface MockProvider {
  server: Server;
  origin: string;
  requests: Array<{ authorization: string | undefined; body: any }>;
}

function sse(...frames: string[]): string {
  return frames.map((frame) => `data: ${frame}\n\n`).join("") + "data: [DONE]\n\n";
}

async function startMockProvider(): Promise<MockProvider> {
  const requests: MockProvider["requests"] = [];

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");

      requests.push({
        authorization: request.headers.authorization,
        body: raw ? JSON.parse(raw) : undefined,
      });

      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
      });
      response.end(
        sse(
          JSON.stringify({
            choices: [{ index: 0, delta: { role: "assistant", content: "Local " } }],
          }),
          JSON.stringify({ choices: [{ index: 0, delta: { content: "model works." } }] }),
          JSON.stringify({
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
          }),
        ),
      );
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no mock port");

  return { server, origin: `http://127.0.0.1:${address.port}`, requests };
}

let mock: MockProvider;
let secrets: InMemoryCredentialStore;

beforeEach(async () => {
  mock = await startMockProvider();
  secrets = new InMemoryCredentialStore();
});

afterEach(async () => {
  await new Promise<void>((resolve) => mock.server.close(() => resolve()));
});

function buildAdapter() {
  const config = resolveLocalModelConfig({
    defaultModel: "my-llm/local-model",
    customProviders: [
      {
        id: "my-llm",
        name: "My LLM",
        baseUrl: `${mock.origin}/v1`,
        api: "openai-completions",
        models: [{ id: "local-model", contextWindow: undefined, maxTokens: undefined, reasoningLevels: [] }],
        contextWindow: 32_000,
        maxTokens: 4_000,
      },
    ],
  });

  const runtime = createLocalRuntime({
    config,
    credentials: new PiCredentialStore(secrets),
  });

  return { config, runtime, adapter: new LocalModelProviderAdapter({ config, runtime }) };
}

/**
 * The model Flue hands the adapter: the alias, never the target. The adapter
 * ignores it by design, and passing the real target here would hide that.
 */
function aliasPlaceholder(): Model<Api> {
  return {
    id: "default",
    name: "default",
    api: LOCAL_ALIAS_API,
    provider: "project-studio",
    baseUrl: "http://127.0.0.1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 4_000,
  };
}

async function collectText(stream: AsyncIterable<any>): Promise<string> {
  let text = "";
  for await (const event of stream) {
    if (event.type === "text_delta") text += event.delta;
    if (event.type === "error") throw new Error(event.error?.errorMessage ?? "stream error");
  }
  return text;
}

describe("local BYOK source", () => {
  it("sends the native file and command tools through the alias to the OpenAI-compatible wire", async () => {
    const directory = await mkdtemp(join(tmpdir(), "studio-native-wire-"));
    const previousHome = process.env.PROJECT_STUDIO_HOME;
    process.env.PROJECT_STUDIO_HOME = join(directory, "home");
    const projectRoot = join(directory, "project");
    await mkdir(projectRoot);
    const database = openDatabase({ path: join(directory, "studio.db") });
    const studio = new StudioRuntime({ database, projectRoot, credentials: secrets });
    try {
      const sandbox = studio.createAgentSandbox({ agentId: "studio", conversationId: "native-wire" });
      const env = await sandbox.createSandbox({ id: "studio" });
      const tools = sandbox.tools?.(env, { subagents: {} }) ?? [];
      const required = ["read", "write", "edit", "move", "delete", "glob", "grep", "shell", "git", "jobs", "discover"];
      expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(required));
      const { adapter } = buildAdapter();
      await collectText(adapter.stream(aliasPlaceholder(), {
        systemPrompt: "Use the available native tools.",
        tools,
        messages: [{ role: "user", content: "Create a file", timestamp: Date.now() }],
      }));
      const body = mock.requests[0]?.body as { tools?: { function: { name: string; parameters: unknown } }[] } | undefined;
      expect(body?.tools?.map((tool) => tool.function.name)).toEqual(expect.arrayContaining(required));
      expect(body?.tools?.find((tool) => tool.function.name === "write")?.function.parameters).toMatchObject({
        required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } },
      });
    } finally {
      await studio.stop();
      database.close();
      if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
      else process.env.PROJECT_STUDIO_HOME = previousHome;
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("resolves the stable alias to the configured model", () => {
    const { adapter } = buildAdapter();

    const descriptor = adapter.resolve(defaultModelReference("local"));

    expect(descriptor.source).toBe("local");
    expect(descriptor.resolvedModelId).toBe("project-studio/default");
    expect(descriptor.capability.contextWindow).toBe(32_000);
    expect(descriptor.operational).toBe(true);
  });

  it("exposes the custom provider's models with provider-qualified ids", () => {
    const { adapter } = buildAdapter();

    const ids = adapter.listModels().map((model) => model.model);

    expect(ids).toContain("default");
    expect(ids).toContain("my-llm/local-model");
  });

  it("reports a misconfigured default model as a configuration error", () => {
    const config = resolveLocalModelConfig({
      defaultModel: "my-llm/does-not-exist",
      customProviders: [
        {
          id: "my-llm",
          name: "My LLM",
          baseUrl: `${mock.origin}/v1`,
          api: "openai-completions",
          models: [{ id: "local-model", contextWindow: undefined, maxTokens: undefined, reasoningLevels: [] }],
          contextWindow: undefined,
          maxTokens: undefined,
        },
      ],
    });
    const runtime = createLocalRuntime({
      config,
      credentials: new PiCredentialStore(secrets),
    });
    const adapter = new LocalModelProviderAdapter({ config, runtime });

    expect(() => adapter.assertTargetResolvable()).toThrow(/is not available/);
  });

  it("streams from the provider and sends the stored key as a bearer token", async () => {
    const { adapter, runtime } = buildAdapter();

    // Connect the provider the way a settings screen would.
    await new PiCredentialStore(secrets).modify("my-llm", async () => ({
      type: "api_key",
      key: "sk-user-supplied-key",
    }));

    const target = adapter.assertTargetResolvable();
    const text = await collectText(
      runtime.models.stream(target, {
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      }),
    );

    expect(text).toBe("Local model works.");

    const [request] = mock.requests;
    expect(request?.authorization).toBe("Bearer sk-user-supplied-key");
    expect(request?.body?.model).toBe("local-model");
    // The alias never reaches the wire; the real model id does.
    expect(JSON.stringify(request?.body)).not.toContain("project-studio");
  });

  /**
   * Ollama and LM Studio need no credential, but Pi's OpenAI-compatible
   * implementation refuses to send a request without an API key. A loopback
   * endpoint therefore gets a placeholder, which those servers ignore.
   */
  it("works with no credential at all, which is how local servers behave", async () => {
    const { adapter, runtime } = buildAdapter();

    const target = adapter.assertTargetResolvable();
    const text = await collectText(
      runtime.models.stream(target, {
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      }),
    );

    expect(text).toBe("Local model works.");
    expect(mock.requests[0]?.authorization).toBe(`Bearer ${LOCAL_PLACEHOLDER_KEY}`);
  });

  /**
   * The alias is not a wire protocol, so the options that reach the adapter are
   * the protocol-independent ones: `reasoning`, not `reasoning_effort` and not
   * `thinkingConfig`. Only Pi's `streamSimple` translates them for the target's
   * actual protocol. Delegating to `stream` instead type-checks and streams a
   * perfectly good answer with the reasoning request silently dropped, which is
   * why this asserts on the wire rather than on the reply.
   */
  it("carries a reasoning request through the alias to the provider", async () => {
    const { adapter, runtime } = buildAdapter();

    // A custom provider's models are declared unable to reason, because the
    // harness cannot verify the claim. This one can, so the protocol has
    // something to ask for.
    const target = { ...adapter.assertTargetResolvable(), reasoning: true };
    const reasoning: LocalRuntime = {
      models: runtime.models,
      target: () => target,
      listModels: runtime.listModels.bind(runtime),
      supportedReasoningLevels: runtime.supportedReasoningLevels.bind(runtime),
    };
    const reasoningAdapter = new LocalModelProviderAdapter({
      config: buildAdapter().config,
      runtime: reasoning,
    });

    await collectText(
      reasoningAdapter.stream(
        aliasPlaceholder(),
        { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
        { reasoning: "medium" },
      ),
    );

    expect(mock.requests[0]?.body?.reasoning_effort).toBe("medium");
  });

  /**
   * Task 38's seam: the alias's id names the model a conversation settled on,
   * and the request must go to THAT model - falling back to the configured
   * default here would be the picker changing nothing about the request,
   * wearing a quieter shape.
   */
  it("routes a request at the model the alias names", async () => {
    const { adapter } = buildAdapter();
    const named: Model<Api> = { ...aliasPlaceholder(), id: "my-llm/local-model" };

    const text = await collectText(
      adapter.stream(
        named,
        { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
      ),
    );

    expect(text).toBe("Local model works.");
    expect(mock.requests[0]?.body?.model).toBe("local-model");
  });

  it("refuses an alias naming a model that does not exist, rather than substituting one", async () => {
    const { adapter } = buildAdapter();
    const named: Model<Api> = { ...aliasPlaceholder(), id: "my-llm/missing-model" };

    expect(() =>
      adapter.stream(named, {
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      }),
    ).toThrow(/is not available/);
    expect(mock.requests).toHaveLength(0);
  });

  /**
   * A model that does not reason keeps sending no reasoning parameter. The
   * run expresses a non-reasoning turn as no explicit effort, which
   * OpenAI-style endpoints render as an ABSENT reasoning_effort - so the
   * absence itself is what the wire must show. Reasoning models now always
   * carry an explicit level through the resting rule instead.
   */
  it("sends no reasoning_effort at all for a model that does not reason", async () => {
    const { adapter } = buildAdapter();

    await collectText(
      adapter.stream(aliasPlaceholder(), {
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      }),
    );

    expect(mock.requests[0]?.body?.reasoning_effort).toBeUndefined();
  });

  /**
   * `xhigh` and `max` only exist for models whose thinkingLevelMap names them;
   * this one does, so the level a conversation chose must arrive verbatim.
   * Pi clamps a level a model cannot honour, which is its answer to a stored
   * choice whose model changed - never a reason to pre-empt it here.
   */
  it("carries max on the wire when the model maps it", async () => {
    const { adapter, runtime } = buildAdapter();
    const target = {
      ...adapter.assertTargetResolvable(),
      reasoning: true,
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    };
    const reasoning: LocalRuntime = {
      models: runtime.models,
      target: () => target,
      listModels: runtime.listModels.bind(runtime),
      supportedReasoningLevels: runtime.supportedReasoningLevels.bind(runtime),
    };
    const reasoningAdapter = new LocalModelProviderAdapter({
      config: buildAdapter().config,
      runtime: reasoning,
    });

    await collectText(
      reasoningAdapter.stream(
        aliasPlaceholder(),
        { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
        { reasoning: "max" },
      ),
    );

    expect(mock.requests[0]?.body?.reasoning_effort).toBe("max");
  });

  it("treats a provider with a stored key as available", async () => {
    const { adapter } = buildAdapter();
    await new PiCredentialStore(secrets).modify("my-llm", async () => ({
      type: "api_key",
      key: "sk-user-supplied-key",
    }));

    const available = await adapter.listAvailableModels();

    expect(available.map((model) => model.model)).toContain("my-llm/local-model");
  });
});
