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

  it("does not create an adapter for local, which is not operational yet", () => {
    expect(() => createModelProviderAdapter("local")).toThrow();
  });

  it("does not create a studio-cloud adapter without validated configuration", () => {
    delete process.env.PROJECT_STUDIO_GATEWAY_URL;
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

describe("startup ordering and adapter boundaries", () => {
  it("validates and bootstraps model providers before observability starts", async () => {
    const source = await readFile(
      new URL("../../src/app.ts", import.meta.url),
      "utf8",
    );

    expect(source.indexOf("bootstrapModelProviders")).toBeGreaterThan(-1);
    expect(source.indexOf("bootstrapModelProviders")).toBeLessThan(
      source.indexOf("initializeObservability("),
    );
  });

  it("keeps the deterministic provider free of network transport", async () => {
    const source = await readFile(
      new URL("../../src/models/adapters/test-adapter.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/\bfetch\b|node:http|XMLHttpRequest|undici/);
  });

  it("does not leak the gateway's Vercel AI SDK types into the harness", async () => {
    for (const path of [
      "../../src/models/adapters/studio-cloud-adapter.ts",
      "../../src/models/studio-cloud/client.ts",
      "../../src/models/studio-cloud/event-mapper.ts",
      "../../src/models/studio-cloud/stream-events.ts",
      "../../src/models/studio-cloud/request-mapper.ts",
    ]) {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      expect(source).not.toMatch(/from "ai"|@ai-sdk\//);
    }
  });

  it("keeps the gateway wire vocabulary independent of the Pi protocol", async () => {
    // stream-events.ts describes what the gateway emits. Projecting that onto
    // Pi belongs to event-mapper.ts; if the wire module starts importing Pi,
    // the two responsibilities have merged again.
    const source = await readFile(
      new URL("../../src/models/studio-cloud/stream-events.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/@earendil-works\/pi-ai|@flue\//);
  });

  it("gives the credential store no plaintext fallback", async () => {
    // The rule is that a secret lives in the OS store or nowhere. Any
    // filesystem or database access from these modules would be a fallback
    // path, which is exactly what must not exist.
    for (const path of [
      "../../src/credentials/credential-store.ts",
      "../../src/credentials/keyring-store.ts",
      "../../src/credentials/memory-store.ts",
    ]) {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      expect(source).not.toMatch(/node:fs|writeFile|readFile|sqlite|\.db\b/i);
    }
  });

  it("keeps credentials out of the model contract and provider config modules", async () => {
    for (const path of [
      "../../src/contracts/models.ts",
      "../../src/models/provider-config.ts",
      "../../src/models/model-registry.ts",
    ]) {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      expect(source).not.toMatch(/authorization|bearer|accessToken|apiKey|secret/i);
    }
  });
});
