import { describe, expect, it, vi } from "vitest";

import { MAX_SECRET_LENGTH } from "../../src/credentials/credential-store.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import {
  parseModelSpecifier,
  resolveLocalModelConfig,
  tolerantLocalModelConfig,
  type CustomProviderModel,
} from "../../src/gateway/language/local/config.js";
import { PiCredentialStore } from "../../src/gateway/language/local/credential-bridge.js";
import { isLanguageCatalogProvider, languageCatalogModels } from "../../src/gateway/language/pi-catalog.js";
import {
  ASSUMED_CUSTOM_CONTEXT_WINDOW,
  ASSUMED_CUSTOM_MAX_TOKENS,
  createLocalRuntime,
} from "../../src/gateway/language/local/runtime.js";

describe("model specifiers", () => {
  it("keeps a stored Azure provider reference and its credential usable after Pi renames the provider", async () => {
    const secrets = new InMemoryCredentialStore();
    const credentials = new PiCredentialStore(secrets);
    await credentials.modify("azure-openai-responses", async () => ({ type: "api_key", key: "legacy-azure-key" }));
    const runtime = createLocalRuntime({
      config: resolveLocalModelConfig({ defaultModel: "azure-openai-responses/gpt-4o" }),
      credentials,
    });
    expect(runtime.target()?.provider).toBe("azure-openai-responses");
    expect(runtime.models.getModel("azure", "gpt-4o")).toBeDefined();
    expect(isLanguageCatalogProvider("azure-openai-responses")).toBe(true);
    expect(languageCatalogModels("azure-openai-responses").some((model) => model.id === "gpt-4o" && model.provider === "azure-openai-responses")).toBe(true);
    expect((await runtime.models.getAuth("azure-openai-responses"))?.auth).toEqual({ apiKey: "legacy-azure-key" });
  });
  it("splits on the first separator so model ids may contain slashes", () => {
    expect(parseModelSpecifier("anthropic/claude-sonnet-4-6")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });

    // OpenRouter ids are themselves slash-separated; splitting on the last
    // separator would silently address the wrong provider.
    expect(parseModelSpecifier("openrouter/anthropic/claude-sonnet-4")).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
    });

    expect(parseModelSpecifier("ollama/llama3.1:8b")).toEqual({
      provider: "ollama",
      model: "llama3.1:8b",
    });
  });

  it("rejects specifiers that name no provider or no model", () => {
    for (const raw of ["", "anthropic", "/claude", "anthropic/"]) {
      expect(() => parseModelSpecifier(raw)).toThrow();
    }
  });
});

describe("local configuration", () => {
  it("requires a default model", () => {
    expect(() => resolveLocalModelConfig({ defaultModel: undefined })).toThrow(
      /PROJECT_STUDIO_LOCAL_DEFAULT_MODEL|required/,
    );
  });

  it("accepts a loopback http provider, which is what local servers use", () => {
    const config = resolveLocalModelConfig({
      defaultModel: "ollama/llama3.1:8b",
      customProviders: [
        {
          id: "ollama",
          name: "Ollama",
          baseUrl: "http://127.0.0.1:11434/v1",
          api: "openai-completions",
          models: [
            {
              id: "llama3.1:8b",
              contextWindow: undefined,
              maxTokens: undefined,
              reasoningLevels: [],
            },
          ],
          contextWindow: undefined,
          maxTokens: undefined,
        },
      ],
    });

    expect(config.defaultProvider).toBe("ollama");
    expect(config.customProviders).toHaveLength(1);
  });

  it("reads model objects from the environment, rejecting invalid ones", () => {
    vi.stubEnv(
      "PROJECT_STUDIO_LOCAL_PROVIDERS",
      JSON.stringify([
        {
          id: "proxy",
          baseUrl: "http://127.0.0.1:8790/v1",
          models: ["a", { id: "b", contextWindow: 5_000 }],
        },
      ]),
    );
    try {
      const config = resolveLocalModelConfig({ defaultModel: "proxy/a" });
      expect(config.customProviders[0]?.models).toEqual([
        { id: "a", contextWindow: undefined, maxTokens: undefined, reasoningLevels: [] },
        { id: "b", contextWindow: 5_000, maxTokens: undefined, reasoningLevels: [] },
      ]);
    } finally {
      vi.unstubAllEnvs();
    }

    vi.stubEnv(
      "PROJECT_STUDIO_LOCAL_PROVIDERS",
      JSON.stringify([
        {
          id: "proxy",
          baseUrl: "http://127.0.0.1:8790/v1",
          models: [{ id: "b", contextWindow: -1 }],
        },
      ]),
    );
    try {
      expect(() => resolveLocalModelConfig({ defaultModel: "proxy/b" })).toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("custom provider runtime limits", () => {
  function runtimeFor(
    models: readonly CustomProviderModel[],
    contextWindow: number | undefined,
    maxTokens: number | undefined,
  ) {
    const config = tolerantLocalModelConfig({
      customProviders: [
        {
          id: "proxy",
          name: "Proxy",
          baseUrl: "http://127.0.0.1:8790/v1",
          api: "openai-completions",
          models,
          contextWindow,
          maxTokens,
        },
      ],
    });
    return createLocalRuntime({
      config,
      credentials: new PiCredentialStore(new InMemoryCredentialStore()),
    });
  }

  const bare = (
    id: string,
  ): CustomProviderModel => ({
    id,
    contextWindow: undefined,
    maxTokens: undefined,
    reasoningLevels: [],
  });

  it("assumes workable limits when a custom model states none", () => {
    const runtime = runtimeFor([bare("big-pickle")], undefined, undefined);

    const model = runtime.models.getModel("proxy", "big-pickle");
    // Pi collapses a 0/0 record to a single-token budget, which reads as a
    // dead provider. Unknown must arrive as a positive assumption instead.
    expect(model?.contextWindow).toBe(ASSUMED_CUSTOM_CONTEXT_WINDOW);
    expect(model?.maxTokens).toBe(ASSUMED_CUSTOM_MAX_TOKENS);
  });

  it("prefers per-model limits, then connection-level ones", () => {
    const runtime = runtimeFor(
      [
        { ...bare("small"), contextWindow: 32_000, maxTokens: 4_000 },
        bare("bare"),
      ],
      128_000,
      8_000,
    );

    expect(runtime.models.getModel("proxy", "small")).toMatchObject({
      contextWindow: 32_000,
      maxTokens: 4_000,
    });
    expect(runtime.models.getModel("proxy", "bare")).toMatchObject({
      contextWindow: 128_000,
      maxTokens: 8_000,
    });
  });

  it("marks models with declared reasoning levels as reasoning", () => {
    const runtime = runtimeFor(
      [{ ...bare("thinker"), reasoningLevels: ["medium"] }],
      undefined,
      undefined,
    );

    expect(runtime.models.getModel("proxy", "thinker")?.reasoning).toBe(true);
  });
});

describe("Pi credential bridge", () => {
  function bridge() {
    const secrets = new InMemoryCredentialStore();
    return { secrets, store: new PiCredentialStore(secrets) };
  }

  it("round-trips an api-key credential", async () => {
    const { store } = bridge();

    await store.modify("openai", async () => ({
      type: "api_key",
      key: "sk-test-123",
    }));

    expect(await store.read("openai")).toEqual({
      type: "api_key",
      key: "sk-test-123",
    });
  });

  it("returns undefined for a provider with no credential", async () => {
    const { store } = bridge();

    expect(await store.read("openai")).toBeUndefined();
  });

  /**
   * The whole reason the bridge chunks: an OAuth credential carrying both
   * tokens is far past the platform's single-entry ceiling.
   */
  it("stores an oauth credential larger than one keychain entry", async () => {
    const { secrets, store } = bridge();
    const access = `a.${"x".repeat(1200)}.sig`;
    const refresh = `r.${"y".repeat(1200)}.sig`;

    await store.modify("anthropic", async () => ({
      type: "oauth",
      access,
      refresh,
      expires: 1893456000000,
    }));

    const read = await store.read("anthropic");
    expect(read).toMatchObject({ type: "oauth", access, refresh });
    // It genuinely spanned multiple entries rather than fitting by luck.
    expect(secrets.size).toBeGreaterThan(2);
  });

  it("shrinks cleanly, leaving no stale trailing chunks", async () => {
    const { store } = bridge();

    await store.modify("openai", async () => ({
      type: "oauth",
      access: "x".repeat(3000),
      refresh: "y".repeat(3000),
      expires: 1,
    }));
    await store.modify("openai", async () => ({
      type: "api_key",
      key: "sk-short",
    }));

    expect(await store.read("openai")).toEqual({
      type: "api_key",
      key: "sk-short",
    });
  });

  it("lists stored providers, which a keychain cannot enumerate on its own", async () => {
    const { store } = bridge();

    await store.modify("openai", async () => ({ type: "api_key", key: "a" }));
    await store.modify("groq", async () => ({ type: "api_key", key: "b" }));

    expect(await store.list()).toEqual([
      { providerId: "groq", type: "api_key" },
      { providerId: "openai", type: "api_key" },
    ]);
  });

  it("removes a credential and drops it from the listing", async () => {
    const { secrets, store } = bridge();
    await store.modify("openai", async () => ({ type: "api_key", key: "a" }));

    await store.delete("openai");

    expect(await store.read("openai")).toBeUndefined();
    expect(await store.list()).toEqual([]);
    // Only the (now empty) index entry remains.
    expect(secrets.size).toBeLessThanOrEqual(1);
  });

  it("leaves the entry unchanged when the modifier returns undefined", async () => {
    const { store } = bridge();
    await store.modify("openai", async () => ({ type: "api_key", key: "keep" }));

    const result = await store.modify("openai", async () => undefined);

    expect(result).toEqual({ type: "api_key", key: "keep" });
    expect(await store.read("openai")).toEqual({ type: "api_key", key: "keep" });
  });

  /**
   * Pi runs OAuth refresh inside `modify` specifically so concurrent requests
   * cannot double-refresh a rotated token. That guarantee is only real if the
   * store serializes writes per provider.
   */
  it("serializes concurrent modifications of one provider", async () => {
    const { store } = bridge();
    await store.modify("openai", async () => ({ type: "api_key", key: "0" }));

    const observed: string[] = [];
    const bump = () =>
      store.modify("openai", async (current) => {
        const value = Number((current as { key?: string }).key ?? "0");
        observed.push(String(value));
        // Yield so an unserialized implementation would interleave here.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { type: "api_key", key: String(value + 1) };
      });

    await Promise.all([bump(), bump(), bump()]);

    expect(observed).toEqual(["0", "1", "2"]);
    expect(await store.read("openai")).toEqual({ type: "api_key", key: "3" });
  });

  it("rejects provider ids that could collide with a chunk entry", async () => {
    const { store } = bridge();

    // `openai.1` is where chunk 1 of `openai` lives.
    await expect(store.read("openai.1")).rejects.toThrow();
    await expect(store.read("Has Space")).rejects.toThrow();
  });

  it("reports a corrupted entry as absent rather than failing every request", async () => {
    const { secrets, store } = bridge();
    await secrets.set({ scope: "provider", id: "openai" }, "not-a-credential");

    expect(await store.read("openai")).toBeUndefined();
  });

  it("keeps each stored credential within the platform entry limit", async () => {
    const { secrets, store } = bridge();
    await store.modify("openai", async () => ({
      type: "oauth",
      access: "x".repeat(5000),
      refresh: "y".repeat(5000),
      expires: 1,
    }));

    // InMemoryCredentialStore enforces the same limit the real keychain does,
    // so reaching here at all proves every chunk fit; assert the bound too.
    expect(MAX_SECRET_LENGTH).toBe(1280);
    expect(secrets.size).toBeGreaterThan(4);
  });
});
