
import { describe, it, expect } from "vitest";
import { applyQuirk, providerQuirks } from "../src/providers/quirks.ts";

describe("quirks immutability and behavior", () => {
  const baseBody = {
    model: "test-model",
    stream: true,
    store: true,
    max_completion_tokens: 100,
    tools: [{ type: "function", function: { name: "lookup", description: "x", parameters: { type: "object" }, strict: true } }],
    reasoning_effort: "medium",
  };
  for (const [provider, patch] of Object.entries(providerQuirks)) {
    it(`does not mutate input for ${provider}`, () => {
      const input = JSON.parse(JSON.stringify(baseBody));
      const copy = JSON.parse(JSON.stringify(input));
      const out = patch(input);
      expect(input).toEqual(copy);
      expect(out).not.toBe(input);
      // Should have returned a new object
      expect(out).toBeDefined();
    });
  }

  it("alibaba strips store and maps max_completion_tokens", () => {
    const out = applyQuirk("alibaba", { model: "qwen", store: true, max_completion_tokens: 50 });
    expect(out.store).toBeUndefined();
    expect(out.max_tokens).toBe(50);
    expect(out.max_completion_tokens).toBeUndefined();
  });

  it("cohere clamps reasoning_effort", () => {
    expect(applyQuirk("cohere", { reasoning_effort: "medium" } as any).reasoning_effort).toBe("high");
    expect(applyQuirk("cohere", { reasoning_effort: "high" } as any).reasoning_effort).toBe("high");
  });

  it("openrouter maps reasoning_effort to reasoning", () => {
    const out = applyQuirk("openrouter", { reasoning_effort: "high" } as any);
    expect((out as any).reasoning).toEqual({ effort: "high" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("unknown provider passthrough", () => {
    const body = { model: "x", hello: 1 };
    expect(applyQuirk("unknown-provider-xyz", body as any)).toEqual(body);
    expect(applyQuirk("unknown-provider-xyz", body as any)).not.toBe(body);
  });
});
