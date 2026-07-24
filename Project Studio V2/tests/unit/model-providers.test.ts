import { afterEach, describe, expect, it } from "vitest";

import {
  defaultModelReference,
  ModelResolutionError,
  ProviderConfigurationError,
  STUDIO_MODEL_ID,
  type ModelCapability,
} from "../../src/contracts/models.js";
import { ModelRegistry } from "../../src/models/model-registry.js";
import { resolveProviderConfig } from "../../src/models/provider-config.js";
import {
  createModelProviderAdapter,
  createProviderBootstrapCoordinator,
} from "../../src/models/bootstrap.js";
import { TestModelProviderAdapter } from "../../src/models/adapters/test-adapter.js";

const originalEnv = { ...process.env };

afterEach(() => {
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

  it("recognizes test, local, and studio-cloud", () => {
    expect(resolveProviderConfig({ source: "test" }).source).toBe("test");
    expect(resolveProviderConfig({ source: "local" }).source).toBe("local");
    expect(resolveProviderConfig({ source: "studio-cloud" }).source).toBe(
      "studio-cloud",
    );
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
});

describe("createModelProviderAdapter", () => {
  it("creates the operational test adapter", () => {
    expect(createModelProviderAdapter("test")).toBeInstanceOf(
      TestModelProviderAdapter,
    );
  });

  it("fails clearly for local, which is not operational yet", () => {
    expect(() => createModelProviderAdapter("local")).toThrow(
      ProviderConfigurationError,
    );
    expect(() => createModelProviderAdapter("local")).toThrow(
      /not available yet/,
    );
  });

  it("fails clearly for studio-cloud when it is not configured", () => {
    delete process.env.PROJECT_STUDIO_GATEWAY_URL;
    expect(() => createModelProviderAdapter("studio-cloud")).toThrow(
      ProviderConfigurationError,
    );
    expect(() => createModelProviderAdapter("studio-cloud")).toThrow(
      /PROJECT_STUDIO_GATEWAY_URL/,
    );
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

  it("fails clearly when local is selected, which is not operational yet", () => {
    const coordinator = createProviderBootstrapCoordinator();
    expect(() => coordinator.bootstrap({ source: "local" })).toThrow(
      ProviderConfigurationError,
    );
  });

  it("fails clearly when studio-cloud is selected without configuration", () => {
    delete process.env.PROJECT_STUDIO_GATEWAY_URL;
    const coordinator = createProviderBootstrapCoordinator();
    expect(() => coordinator.bootstrap({ source: "studio-cloud" })).toThrow(
      ProviderConfigurationError,
    );
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
