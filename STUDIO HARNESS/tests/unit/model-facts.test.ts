import { describe, expect, it } from "vitest";

import { lookupModelFacts, modelSlugOf } from "../../src/gateway/catalog/model-facts.js";

/**
 * The catalog's word on a slug typed by hand. Pinned against the installed
 * Pi package, so the exact numbers move with it; what is pinned is the rule -
 * which entries count as the same model, and how a disagreement between
 * hosts resolves - on models many hosts serve.
 */
describe("modelSlugOf", () => {
  it("keeps the last segment and drops a variant suffix, without case", () => {
    expect(modelSlugOf("openai/gpt-oss-120b")).toBe("gpt-oss-120b");
    expect(modelSlugOf("accounts/fireworks/models/gpt-oss-120b")).toBe("gpt-oss-120b");
    expect(modelSlugOf("z-ai/glm-5.3-flash:batch")).toBe("glm-5.3-flash");
    expect(modelSlugOf("  GLM-5.3-Flash ")).toBe("glm-5.3-flash");
  });
});

describe("lookupModelFacts", () => {
  it("finds a model many hosts serve and settles on the numbers most of them state", () => {
    const facts = lookupModelFacts("glm-5.3-flash");
    expect(facts).toBeDefined();
    expect(facts?.entries).toBeGreaterThan(1);
    // Z.ai, OpenRouter and the coding plans all say a million-token window;
    // Cloudflare's larger figure is the minority and loses.
    expect(facts?.contextWindow).toBe(1_000_000);
    expect(facts?.maxOutputTokens).toBe(131_072);
    expect(facts?.reasoning).toBe(true);
    expect(facts?.vision).toBe(true);
    expect(facts?.reasoningLevels.length).toBeGreaterThan(0);
  });

  it("matches a host-prefixed id to the same model", () => {
    expect(lookupModelFacts("openai/gpt-oss-120b")?.contextWindow).toBe(
      lookupModelFacts("gpt-oss-120b")?.contextWindow,
    );
  });

  it("answers nothing for a slug nobody lists", () => {
    expect(lookupModelFacts("my-private-finetune-7b")).toBeUndefined();
    expect(lookupModelFacts("")).toBeUndefined();
  });
});
