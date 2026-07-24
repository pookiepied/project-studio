import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { PassthroughContextOptimizer } from "../../src/context/context-optimizer.js";
import {
  defaultModelReference,
  ModelResolutionError,
  STUDIO_MODEL_ID,
} from "../../src/contracts/models.js";
import { ModelRegistry } from "../../src/models/model-registry.js";
import { TestModelProviderAdapter } from "../../src/models/adapters/test-adapter.js";
import { resolveProviderConfig } from "../../src/models/provider-config.js";
import { createModelProviderAdapter } from "../../src/models/bootstrap.js";

describe("harness boundaries", () => {
  it("resolves model references through adapter contracts", () => {
    const registry = new ModelRegistry();
    registry.registerAdapter(new TestModelProviderAdapter());

    expect(registry.resolve(defaultModelReference("test"))).toBe(
      "project-studio/default",
    );
  });

  it("throws a ModelResolutionError for unregistered sources", () => {
    const registry = new ModelRegistry();

    expect(() => registry.resolve(defaultModelReference("local"))).toThrow(
      ModelResolutionError,
    );
  });

  it("keeps canonical context available when optimization is disabled", async () => {
    const optimizer = new PassthroughContextOptimizer();
    const context = { messages: [{ role: "user", content: "hello" }] };

    const result = await optimizer.optimize(context);

    expect(result.optimizer).toBe("passthrough");
    expect(result.canonical).toBe(context);
    expect(result.optimized).toBe(context);
  });
});

describe("model-provider composition", () => {
  it("uses a stable STUDIO_MODEL_ID that does not name a source", () => {
    expect(STUDIO_MODEL_ID).toBe("project-studio/default");

    const descriptor = new TestModelProviderAdapter().resolve(
      defaultModelReference("test"),
    );
    expect(descriptor.resolvedModelId).toBe(STUDIO_MODEL_ID);
  });

  it("defaults to the test source", () => {
    const config = resolveProviderConfig();
    expect(config.source).toBe("test");
  });

  it("creates the operational adapter for test", () => {
    expect(createModelProviderAdapter("test")).toBeInstanceOf(
      TestModelProviderAdapter,
    );
  });

  it("does not create an adapter for local or studio-cloud in this phase", () => {
    expect(() => createModelProviderAdapter("local")).toThrow();
    expect(() => createModelProviderAdapter("studio-cloud")).toThrow();
  });

  it("rejects invalid source values", () => {
    expect(() => resolveProviderConfig({ source: "invalid" as never })).toThrow(
      /Invalid model source/,
    );
  });
});

describe("studio agent has no gateway or provider side effects", () => {
  it("does not reference gateway URLs, keys, tokens, or a specific provider implementation", async () => {
    const source = await readFile(
      new URL("../../src/agents/studio.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/https?:\/\//i);
    expect(source).not.toMatch(/apiKey|api_key|token|secret/i);
    expect(source).not.toMatch(/deterministic|test-adapter|local-adapter|studio-cloud-adapter/i);
    expect(source).toContain("STUDIO_MODEL_ID");
  });

  it("does not import an adapter module for side effects", async () => {
    const source = await readFile(
      new URL("../../src/agents/studio.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/models\/adapters/);
  });
});
