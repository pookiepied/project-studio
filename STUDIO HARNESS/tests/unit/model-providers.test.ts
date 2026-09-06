import { afterEach, describe, expect, it } from "vitest";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { createModels, createProvider, lazyApi } from "@earendil-works/pi-ai";
import { hasProvider, resolveModel } from "@flue/runtime/internal";

import {
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
  defaultModelReference,
  ModelResolutionError,
  ProviderConfigurationError,
  STUDIO_MODEL_ID,
  type ModelCapability,
} from "../../src/contracts/models.js";
import { ModelRegistry } from "../../src/models/model-registry.js";
import { resolveProviderConfig } from "../../src/models/provider-config.js";
import { API_LOADERS } from "../../src/models/local/apis.js";
import type { LocalModelConfig } from "../../src/models/local/config.js";
import {
  createModelProviderAdapter,
  createProviderBootstrapCoordinator,
} from "../../src/models/bootstrap.js";
import { TestModelProviderAdapter, stream } from "../../src/models/adapters/test-adapter.js";
import { LocalModelProviderAdapter } from "../../src/models/adapters/local-adapter.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

// Bootstrapping `local` reads provider settings. Point the store at memory so
// these tests never touch — or depend on — the developer's real settings.
process.env.PROJECT_STUDIO_STORE_PATH = ":memory:";

const originalEnv = { ...process.env };

/**
 * Opened per test rather than shared through a module global. The global made
 * `PROJECT_STUDIO_STORE_PATH` inert for whichever test ran second.
 */
let database: StudioDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
});

describe("provider configuration", () => {
  it("defaults to test source", () => {
    expect(resolveProviderConfig().source).toBe("test");
  });

  it("recognizes test and local", () => {
    expect(resolveProviderConfig({ source: "test" }).source).toBe("test");
    expect(resolveProviderConfig({ source: "local" }).source).toBe("local");
  });

  it("reads source from PROJECT_STUDIO_MODEL_SOURCE", () => {
    process.env.PROJECT_STUDIO_MODEL_SOURCE = "local";
    expect(resolveProviderConfig().source).toBe("local");
  });

  it("rejects an unknown source with a safe error", () => {
    expect(() =>
      resolveProviderConfig({ source: "invalid" as never }),
    ).toThrow(ProviderConfigurationError);
  });

  it("rejects an unknown env source with a safe error", () => {
    process.env.PROJECT_STUDIO_MODEL_SOURCE = "invalid";
    expect(() => resolveProviderConfig()).toThrow(ProviderConfigurationError);
  });
});

describe("test adapter", () => {
  it("is operational and registers with Flue idempotently", () => {
    const adapter = new TestModelProviderAdapter();
    expect(adapter.operational).toBe(true);
    adapter.register();
    adapter.register();
  });

  it("resolves the default reference to the stable alias", () => {
    const adapter = new TestModelProviderAdapter();
    const descriptor = adapter.resolve(defaultModelReference("test"));
    expect(descriptor.resolvedModelId).toBe(STUDIO_MODEL_ID);
    expect(descriptor.operational).toBe(true);
  });

  it("rejects a reference for another source", () => {
    const adapter = new TestModelProviderAdapter();
    expect(() =>
      adapter.resolve({
        source: "local",
        provider: "project-studio",
        model: "default",
      }),
    ).toThrow(ModelResolutionError);
  });

  it("rejects an unknown provider", () => {
    const adapter = new TestModelProviderAdapter();
    expect(() =>
      adapter.resolve({
        source: "test",
        provider: "openai",
        model: "default",
      }),
    ).toThrow(ModelResolutionError);
  });

  it("rejects an unknown model", () => {
    const adapter = new TestModelProviderAdapter();
    expect(() =>
      adapter.resolve({
        source: "test",
        provider: "project-studio",
        model: "does-not-exist",
      }),
    ).toThrow(ModelResolutionError);
  });

  it("never silently rewrites source, provider, or model on resolution", () => {
    const adapter = new TestModelProviderAdapter();
    expect(() =>
      adapter.resolve({
        source: "test",
        provider: "anthropic",
        model: "claude",
      }),
    ).toThrow(ModelResolutionError);
  });

  it("resolves synchronously with no network involved", () => {
    const adapter = new TestModelProviderAdapter();
    adapter.register();
    const descriptor = adapter.resolve(defaultModelReference("test"));
    expect(descriptor.source).toBe("test");
  });

  it("spreads a [pace] answer's deltas over wall-clock time", async () => {
    // A seam whose deltas all land inside one tick cannot exercise live
    // streaming: no reader, ours or a test's, can tell a delivery made
    // during the turn from a replay made after it. `[pace]` is the seam's
    // answer, and this test is its contract: more than two deltas, and a
    // first-to-last span that no synchronous emission could produce.
    // The scripted stream is called directly: under Flue 2.0 the adapter's
    // registration half is Phase 5's port, and this test's subject is the
    // [pace] contract of the script itself, not a registry lookup.
    const streamSimple = stream;

    const model: Model<"project-studio-test"> = {
      id: "default",
      name: "default",
      api: "project-studio-test",
      provider: "project-studio",
      baseUrl: "in-process://project-studio-test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_000,
      maxTokens: 4_096,
    };
    const context: Context = {
      messages: [
        { role: "user", content: "[pace] a short answer", timestamp: Date.now() },
      ],
    };

    const deltaArrivals: number[] = [];
    for await (const event of streamSimple(model, context)) {
      if (event.type === "text_delta") deltaArrivals.push(Date.now());
    }

    expect(deltaArrivals.length).toBeGreaterThan(2);
    const first = deltaArrivals.at(0);
    const last = deltaArrivals.at(-1);
    if (first === undefined || last === undefined) {
      throw new Error("the delta arrivals above were asserted non-empty");
    }
    expect(last - first).toBeGreaterThanOrEqual(900);
  });
});

describe("createModelProviderAdapter", () => {
  it("creates the operational test adapter", () => {
    expect(createModelProviderAdapter("test")).toBeInstanceOf(
      TestModelProviderAdapter,
    );
  });

  it("starts unconfigured rather than dead when no default model is chosen", () => {
    // A first launch has connected nothing. That is a state for the settings
    // UI to fix, not a startup failure: the harness must come up so provider
    // management can reach it, and refuse individual turns instead.
    delete process.env.PROJECT_STUDIO_LOCAL_DEFAULT_MODEL;
    const opened = openDatabase();
    database = opened;

    const adapter = createModelProviderAdapter("local", { database: opened });
    expect(adapter.source).toBe("local");

    const descriptor = adapter.resolve(defaultModelReference("local"));
    expect(descriptor.operational).toBe(false);
  });

  it("refuses an unconfigured turn with directions, not a crash", () => {
    delete process.env.PROJECT_STUDIO_LOCAL_DEFAULT_MODEL;
    const opened = openDatabase();
    database = opened;
    const adapter = createModelProviderAdapter("local", { database: opened });

    // Narrowed rather than declared on `ModelProviderAdapter`: refusing an
    // unroutable turn with directions is how the LOCAL BYOK adapter behaves,
    // not part of what a provider adapter is. Putting it on the interface
    // would also drag Pi's `Model<Api>` into `contracts/models.ts`, whose
    // whole point is to describe adapters without naming a gateway.
    if (!(adapter instanceof LocalModelProviderAdapter)) {
      throw new Error("the local source must build the local adapter");
    }
    expect(() => adapter.assertTargetResolvable()).toThrow(
      ProviderConfigurationError,
    );
    expect(() => adapter.assertTargetResolvable()).toThrow(
      /No default model is selected/,
    );
  });

  it("creates the operational local adapter when it is configured", () => {
    const adapter = createModelProviderAdapter("local", {
      local: {
        config: {
          defaultProvider: "openai",
          defaultModel: "gpt-4o-mini",
          customProviders: [],
          extraModels: [],
        },
        credentials: new InMemoryCredentialStore(),
      },
    });

    expect(adapter.source).toBe("local");
    expect(adapter.operational).toBe(true);
  });

  it("throws for an unknown source", () => {
    expect(() => createModelProviderAdapter("invalid" as never)).toThrow(
      ProviderConfigurationError,
    );
  });
});

describe("model registry", () => {
  it("resolves and returns descriptors with capability metadata", () => {
    const registry = new ModelRegistry();
    registry.registerAdapter(new TestModelProviderAdapter());

    const descriptor = registry.resolveDescriptor(
      defaultModelReference("test"),
    );
    expect(descriptor.resolvedModelId).toBe(STUDIO_MODEL_ID);
    expect(descriptor.capability.toolCalling).toBe("supported");
    expect(descriptor.capability.contextWindow).toBe(32_000);
  });

  it("throws ModelResolutionError for unregistered sources", () => {
    const registry = new ModelRegistry();
    expect(() => registry.resolve(defaultModelReference("test"))).toThrow(
      ModelResolutionError,
    );
  });

  it("prevents duplicate adapter registration for the same source", () => {
    const registry = new ModelRegistry();
    registry.registerAdapter(new TestModelProviderAdapter());
    expect(() =>
      registry.registerAdapter(new TestModelProviderAdapter()),
    ).toThrow(/already registered/);
  });

  it("validate does not throw for a registered reference", () => {
    const registry = new ModelRegistry();
    registry.registerAdapter(new TestModelProviderAdapter());
    expect(() =>
      registry.validate(defaultModelReference("test")),
    ).not.toThrow();
  });

  it("validate throws for an unregistered reference", () => {
    const registry = new ModelRegistry();
    expect(() =>
      registry.validate(defaultModelReference("local")),
    ).toThrow(ModelResolutionError);
  });

  it("listModels returns at least one model per registered adapter", () => {
    const registry = new ModelRegistry();
    registry.registerAdapter(new TestModelProviderAdapter());
    expect(registry.listModels().length).toBeGreaterThanOrEqual(1);
  });
});

describe("provider bootstrap coordinator", () => {
  it("bootstraps the test source successfully", () => {
    const coordinator = createProviderBootstrapCoordinator();
    const result = coordinator.bootstrap({ source: "test" });

    expect(result.config.source).toBe("test");
    expect(result.registry).toBeInstanceOf(ModelRegistry);
    expect(result.descriptor.resolvedModelId).toBe(STUDIO_MODEL_ID);
  });

  it("returns a registry that already has the operational adapter registered", () => {
    const coordinator = createProviderBootstrapCoordinator();
    const result = coordinator.bootstrap({ source: "test" });

    expect(result.registry.hasSource("test")).toBe(true);
    expect(() =>
      result.registry.validate(defaultModelReference("test")),
    ).not.toThrow();
  });

  it("fails clearly when local is selected with no default model chosen", () => {
    delete process.env.PROJECT_STUDIO_LOCAL_DEFAULT_MODEL;
    const coordinator = createProviderBootstrapCoordinator();
    expect(() => coordinator.bootstrap({ source: "local" })).toThrow(
      ProviderConfigurationError,
    );
  });

  it("bootstraps local from a stored default model, with no environment variable", () => {
    // The subphase 5 payoff, carried into the merged store: what the user
    // chose in settings is what the harness starts on. The default now lives
    // in `provider_default` pointing at a connection row, so that is what
    // this writes - directly, because what is under test is the derivation
    // from the merged rows, not the store's write path.
    delete process.env.PROJECT_STUDIO_LOCAL_DEFAULT_MODEL;
    const opened = openDatabase();
    database = opened;

    opened
      .prepare(
        `INSERT INTO provider_connection_record (id, record_json, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(
        "ollama",
        JSON.stringify({
          id: "ollama",
          displayName: "Ollama",
          kind: "language",
          source: "local",
          baseUrl: "http://127.0.0.1:11434/v1",
          enabled: true,
          protocol: "openai-completions",
        }),
        Date.now(),
      );
    opened
      .prepare(
        `INSERT INTO provider_model_manual (connection_id, model_id, record_json, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        "ollama",
        "llama3.1:8b",
        JSON.stringify({
          connectionId: "ollama",
          modelId: "llama3.1:8b",
          displayName: "llama3.1:8b",
          capability: {
            textGeneration: "supported",
            streaming: "unknown",
            reasoning: "unknown",
            toolCalling: "unknown",
            vision: "unknown",
            embeddings: "unknown",
            reranking: "unknown",
            imageGeneration: "unknown",
            imageEditing: "unknown",
            videoGeneration: "unknown",
            speechGeneration: "unknown",
            transcription: "unknown",
            webSearch: "unknown",
            webFetch: "unknown",
            contextWindow: "unknown",
            maxOutputTokens: "unknown",
          },
          reasoningLevels: [],
          shape: "stream",
          pricing: {
            input: "unknown",
            output: "unknown",
            cacheRead: "unknown",
            cacheWrite: "unknown",
          },
          hidden: false,
          origin: "manual",
        }),
        Date.now(),
      );
    opened
      .prepare(
        `INSERT INTO provider_default (slot, connection_id, model_id, updated_at)
         VALUES ('textGeneration', 'ollama', 'llama3.1:8b', ?)`,
      )
      .run(Date.now());

    const result = createProviderBootstrapCoordinator().bootstrap(
      { source: "local" },
      { database: opened },
    );

    expect(result.descriptor.operational).toBe(true);
    expect(result.descriptor.resolvedModelId).toBe(STUDIO_MODEL_ID);
  });

  it("rejects a second bootstrap call on the same coordinator", () => {
    const coordinator = createProviderBootstrapCoordinator();
    coordinator.bootstrap({ source: "test" });
    expect(() => coordinator.bootstrap({ source: "test" })).toThrow(
      ProviderConfigurationError,
    );
  });

  it("marks itself initialized even when bootstrap fails, so a caller cannot retry around a bad source", () => {
    const coordinator = createProviderBootstrapCoordinator();
    expect(() => coordinator.bootstrap({ source: "local" })).toThrow();
    expect(() => coordinator.bootstrap({ source: "test" })).toThrow(
      ProviderConfigurationError,
    );
  });

  it("each coordinator instance is independent (no global-state contamination)", () => {
    const first = createProviderBootstrapCoordinator();
    const second = createProviderBootstrapCoordinator();

    expect(() => first.bootstrap({ source: "test" })).not.toThrow();
    expect(() => second.bootstrap({ source: "test" })).not.toThrow();
  });
});

describe("studio agent model stability", () => {
  it("STUDIO_MODEL_ID is a stable, gateway-neutral alias", () => {
    expect(STUDIO_MODEL_ID).toBe("project-studio/default");
    expect(STUDIO_MODEL_ID).not.toMatch(/deterministic|test|local|cloud/i);
  });

  it("the operational adapter resolves the alias for the default reference", () => {
    const coordinator = createProviderBootstrapCoordinator();
    const result = coordinator.bootstrap({ source: "test" });
    expect(result.descriptor.resolvedModelId).toBe(STUDIO_MODEL_ID);
  });
});

describe("capability representation", () => {
  const capability: ModelCapability = new TestModelProviderAdapter().resolve(
    defaultModelReference("test"),
  ).capability;

  it("represents every required capability dimension", () => {
    const dimensions: (keyof ModelCapability)[] = [
      "textGeneration",
      "streaming",
      "reasoning",
      "toolCalling",
      "vision",
      "embeddings",
      "reranking",
      "imageGeneration",
      "videoGeneration",
      "speechGeneration",
      "transcription",
      "contextWindow",
      "maxOutputTokens",
    ];

    for (const dimension of dimensions) {
      expect(capability[dimension]).not.toBeUndefined();
    }
  });

  it("distinguishes unknown from unsupported capability states", () => {
    expect(capability.vision).toBe("unsupported");

    const undescribed: ModelCapability = { ...capability, vision: "unknown" };
    expect(undescribed.vision).toBe("unknown");
    expect(undescribed.vision).not.toBe(capability.vision);
  });

  it("does not encode unknown numeric limits as zero", () => {
    expect(capability.contextWindow).not.toBe(0);
    expect(capability.maxOutputTokens).not.toBe(0);
    expect(typeof capability.contextWindow).toBe("number");
  });
});

describe("the Flue provider mount", () => {
  it("registers the alias provider with the runtime's own model collection", () => {
    // The proof the registration TOOK is read from the runtime's own side -
    // the same Models instance the session's streamSimple dispatches
    // through - not from our module state. The hazard Phase 5 inherited was
    // a dual pi-ai install, where a provider built against the wrong copy
    // could never be the one the runtime resolves through; the pnpm
    // override in package.json dedupes pi-ai to one instance, so this
    // registration and the runtime's resolution are one collection by
    // construction, and a positive read here would fail loudly if two
    // copies ever came back.
    const coordinator = createProviderBootstrapCoordinator();
    coordinator.bootstrap({ source: "test" });
    expect(hasProvider(DEFAULT_MODEL_PROVIDER)).toBe(true);
  });

  it("resolves the alias and any stored reference against the test mount", () => {
    const coordinator = createProviderBootstrapCoordinator();
    coordinator.bootstrap({ source: "test" });

    const alias = resolveModel(STUDIO_MODEL_ID);
    expect(alias.provider).toBe(DEFAULT_MODEL_PROVIDER);
    expect(alias.id).toBe(DEFAULT_MODEL_NAME);

    // A conversation may store a real catalog id (the picker's vocabulary);
    // the dynamic template resolves it to a synthesized model so the turn
    // still runs the scripted stream - 1.0's any-id registration behaviour,
    // in 2.0's spelling.
    const stored = resolveModel(`${DEFAULT_MODEL_PROVIDER}/openrouter/anthropic/claude-test`);
    expect(stored.id).toBe("openrouter/anthropic/claude-test");
    expect(stored.provider).toBe(DEFAULT_MODEL_PROVIDER);
  });

  it("mounts the local catalog under qualified ids with mirrored facts", () => {
    // The local source mounts one alias provider whose model list mirrors
    // the local runtime's catalog: the stable default plus every model under
    // its qualified `<provider>/<model>` id - exactly the reference the
    // conversation index stores. The facts ride along, so the runtime reads
    // an honest context window instead of a zero.
    const collection = createModels();
    const gatewayModel: Model<Api> = {
      id: "gpt-x",
      name: "GPT X",
      api: "openai-completions",
      provider: "my-gateway",
      baseUrl: "https://gateway.invalid/v1",
      reasoning: true,
      input: ["text"],
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8_000,
      maxTokens: 1_000,
    };
    collection.setProvider(
      createProvider({
        id: "my-gateway",
        name: "my-gateway",
        baseUrl: "https://gateway.invalid/v1",
        auth: {
          apiKey: {
            name: "test key",
            async resolve() {
              return { auth: { apiKey: "test-key" }, source: "test" };
            },
          },
        },
        models: [gatewayModel],
        api: lazyApi(
          API_LOADERS["openai-completions"] ??
            (() => Promise.reject(new Error("no loader"))),
        ),
      }),
    );
    const config: LocalModelConfig = {
      defaultProvider: undefined,
      defaultModel: undefined,
      customProviders: [],
      extraModels: [],
    };
    const adapter = new LocalModelProviderAdapter({
      config,
      runtime: {
        models: collection,
        target: () => undefined,
        listModels: () => collection.getModels(),
        supportedReasoningLevels: () => [],
      },
    });
    adapter.register();

    const mounted = resolveModel(`${DEFAULT_MODEL_PROVIDER}/my-gateway/gpt-x`);
    expect(mounted.provider).toBe(DEFAULT_MODEL_PROVIDER);
    expect(mounted.contextWindow).toBe(8_000);
    expect(mounted.maxTokens).toBe(1_000);
    expect(mounted.reasoning).toBe(true);

    // And the alias itself resolves even with no configured default: the
    // entry exists so resolution succeeds and the turn fails later, in
    // assertTargetResolvable, which names what to fix.
    const alias = resolveModel(STUDIO_MODEL_ID);
    expect(alias.id).toBe(DEFAULT_MODEL_NAME);

    // The local mount is exact: a reference the catalog does not name is a
    // resolution failure, not a silent route to something else.
    expect(() =>
      resolveModel(`${DEFAULT_MODEL_PROVIDER}/my-gateway/not-in-catalog`),
    ).toThrow();
  });
});
