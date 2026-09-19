import { describe, expect, it } from "vitest";

import { pricingFromPiModel } from "../../src/gateway/language/pi-catalog.js";

/**
 * Pi's cost bag becomes the pricing record the library prints. A figure is
 * a price only when it is one: a missing or non-numeric field is unknown,
 * and so is a negative one, which is OpenRouter's way of saying the price
 * varies by route rather than a debt of a million dollars per token.
 */
describe("pricingFromPiModel", () => {
  it("reads the four figures per million", () => {
    expect(pricingFromPiModel({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 })).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    });
  });

  it("treats a negative figure as no fixed price, like a missing one", () => {
    expect(pricingFromPiModel({ input: -1_000_000, output: -1_000_000 })).toEqual({
      input: "unknown",
      output: "unknown",
      cacheRead: "unknown",
      cacheWrite: "unknown",
    });
  });

  it("keeps a free model at zero, which is a price", () => {
    expect(pricingFromPiModel({ input: 0, output: 0 }).input).toBe(0);
  });
});
