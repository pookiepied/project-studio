import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import { createModels, createProvider, lazyApi } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { LocalModelProviderAdapter } from "../../src/models/adapters/local-adapter.js";
import { TestModelProviderAdapter } from "../../src/models/adapters/test-adapter.js";
import {
  backgroundLadderSpecifier,
} from "../../src/models/background-model.js";
import { ModelRegistry } from "../../src/models/model-registry.js";
import type { LocalModelConfig } from "../../src/models/local/config.js";
import { API_LOADERS } from "../../src/models/local/apis.js";

const ZERO_CONTEXT = { contextWindow: 8_000, maxTokens: 1_000 };

function pricedModel(
  provider: string,
  id: string,
  input: number,
  output: number,
): Model<Api> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider,
    baseUrl: "https://models.invalid/v1",
    reasoning: false,
    input: ["text"],
    cost: { input, output, cacheRead: 0, cacheWrite: 0 },
    ...ZERO_CONTEXT,
  };
}

/**
 * A model collection built by hand, so the pricing is the test's own and
 * the cheapest-selection policy is measured against known rates.
 */
function collectionWith(
  providers: {
    id: string;
    models: Model<Api>[];
    configured: boolean;
  }[],
): MutableModels {
  const models = createModels();
  for (const provider of providers) {
    models.setProvider(
      createProvider({
        id: provider.id,
        name: provider.id,
        baseUrl: "https://models.invalid/v1",
        auth: {
          apiKey: {
            name: "Test API key",
            async resolve() {
              return provider.configured
                ? { auth: { apiKey: "test-key" }, source: "test" }
                : undefined;
            },
          },
        },
        models: provider.models,
        api: lazyApi(API_LOADERS["openai-completions"] ?? (() => Promise.reject(new Error("no loader")))),
      }),
    );
  }
  return models;
}

function adapterOver(models: MutableModels): LocalModelProviderAdapter {
  const config: LocalModelConfig = {
    defaultProvider: undefined,
    defaultModel: undefined,
    customProviders: [],
    extraModels: [],
  };
  return new LocalModelProviderAdapter({
    config,
    runtime: {
      models,
      target: () => undefined,
      listModels: () => models.getModels(),
    },
  });
}

describe("the background model policy", () => {
  it("answers with the alias for the deterministic test source", async () => {
    const adapter = new TestModelProviderAdapter();
    expect(await adapter.backgroundModel()).toBe("project-studio/default");

    const registry = new ModelRegistry();
    registry.registerAdapter(adapter);
    expect(await registry.backgroundModel()).toBe("project-studio/default");
    // One rung: a retry on this source has nothing to step down to.
    expect(await adapter.backgroundModel(1)).toBeUndefined();
  });

  it("picks the least expensive model with working credentials", async () => {
    const adapter = adapterOver(
      collectionWith([
        {
          id: "frontier",
          configured: true,
          models: [
            pricedModel("frontier", "expensive", 30, 120),
            pricedModel("frontier", "mid", 3, 15),
          ],
        },
        {
          id: "budget",
          configured: true,
          models: [pricedModel("budget", "cheap", 0.5, 2)],
        },
        // Connected without credentials: the harness cannot pay for it, so
        // it is never proposed.
        {
          id: "unpaid",
          configured: false,
          models: [pricedModel("unpaid", "free-ish", 0.1, 0.4)],
        },
      ]),
    );

    expect(await adapter.backgroundModel()).toBe("project-studio/budget/cheap");
  });

  it("refuses to rank a negative rate, which is not a price", async () => {
    // Gateways encode "cost unknown until a router picks" as a negative
    // rate. A policy whose job is bounding the spend cannot be bounded by
    // one, and it would otherwise always sort first.
    const adapter = adapterOver(
      collectionWith([
        {
          id: "router",
          configured: true,
          models: [pricedModel("router", "auto", -1, -1)],
        },
        {
          id: "budget",
          configured: true,
          models: [pricedModel("budget", "cheap", 0.5, 2)],
        },
      ]),
    );

    expect(await adapter.backgroundModel()).toBe("project-studio/budget/cheap");
  });

  it("steps down the ladder with skip", async () => {
    const adapter = adapterOver(
      collectionWith([
        {
          id: "budget",
          configured: true,
          models: [
            pricedModel("budget", "first", 0, 0),
            pricedModel("budget", "second", 0, 0),
          ],
        },
      ]),
    );

    expect(await adapter.backgroundModel(0)).toBe("project-studio/budget/first");
    expect(await adapter.backgroundModel(1)).toBe("project-studio/budget/second");
    expect(await adapter.backgroundModel(2)).toBeUndefined();
  });

  it("prefers a zero-cost endpoint, which is genuinely free", async () => {
    const adapter = adapterOver(
      collectionWith([
        {
          id: "frontier",
          configured: true,
          models: [pricedModel("frontier", "expensive", 30, 120)],
        },
        {
          id: "local-server",
          configured: true,
          models: [pricedModel("local-server", "qwen", 0, 0)],
        },
      ]),
    );

    expect(await adapter.backgroundModel()).toBe(
      "project-studio/local-server/qwen",
    );
  });

  it("answers undefined when no connected model can be reached", async () => {
    const adapter = adapterOver(
      collectionWith([
        {
          id: "unpaid",
          configured: false,
          models: [pricedModel("unpaid", "model", 1, 2)],
        },
      ]),
    );

    expect(await adapter.backgroundModel()).toBeUndefined();

    const registry = new ModelRegistry();
    registry.registerAdapter(adapter);
    expect(await registry.backgroundModel()).toBeUndefined();
  });

  it("keeps the alias fallback in a process with no model layer", () => {
    // The ladder read is synchronous now (a Flue 2.0 render cannot await),
    // and the fallback is the same as 1.0's: no bootstrapped registry means
    // nothing cheaper is known, rank zero reads the alias, and a retry has
    // no rung to step down to.
    expect(backgroundLadderSpecifier(0)).toBe("project-studio/default");
    expect(backgroundLadderSpecifier(1)).toBeUndefined();
  });

  it("serves the ladder from the snapshot, and the snapshot only changes on refresh", async () => {
    // The ladder a render reads is the model layer's maintained answer, not
    // a live query: an unrefreshed registry answers nothing, and a refresh
    // - what the composition root awaits before the server can accept a
    // dispatch - fills every rank the source can name, in the same order
    // the per-rank query answers them.
    const adapter = adapterOver(
      collectionWith([
        {
          id: "budget",
          configured: true,
          models: [
            pricedModel("budget", "cheap", 0.5, 2),
            pricedModel("budget", "cheaper", 0, 0),
          ],
        },
      ]),
    );
    const registry = new ModelRegistry();
    registry.registerAdapter(adapter);

    expect(registry.backgroundLadder()).toEqual([]);

    await registry.refreshBackgroundLadder();
    expect(registry.backgroundLadder()).toEqual([
      "project-studio/budget/cheaper",
      "project-studio/budget/cheap",
    ]);
    expect(await registry.backgroundModel(0)).toBe(registry.backgroundLadder()[0]);
    expect(await registry.backgroundModel(1)).toBe(registry.backgroundLadder()[1]);

    // The refresh recomputes; a second one changes nothing when the
    // availability has not moved.
    await registry.refreshBackgroundLadder();
    expect(registry.backgroundLadder()).toEqual([
      "project-studio/budget/cheaper",
      "project-studio/budget/cheap",
    ]);
  });
});
