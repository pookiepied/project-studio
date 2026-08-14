
import { describe, it, expect } from "vitest";
import { parseReasoning, REASONING_BUDGET_MAX_TOKENS, REASONING_BUDGET_MIN_TOKENS } from "../src/gateway/resolver.ts";
import { resolveReasoning, buildProviderOptionsForReasoning, normalizeMessagesForSDK, isBudgetSupported } from "../src/providers/shared/runtime.ts";
import { mapFinishReason } from "../src/providers/shared/normalization.ts";

describe("parseReasoning", () => {
  it("parses portable reasoning string", () => {
    expect(parseReasoning({ reasoning: "high" })).toEqual({ mode: "adaptive", level: "high" });
    expect(parseReasoning({ reasoning: "none" })).toEqual({ mode: "none" });
  });
  it("parses legacy reasoning_effort", () => {
    expect(parseReasoning({ reasoning_effort: "low" })).toEqual({ mode: "adaptive", level: "low" });
  });
  it("parses exact budget", () => {
    expect(parseReasoning({ budgetTokens: 12000 } as any)).toEqual({ mode: "budget", budgetTokens: 12000 });
    expect(parseReasoning({ reasoning: { budgetTokens: 8000 } } as any)).toEqual({ mode: "budget", budgetTokens: 8000 });
  });
  it("validates budgetTokens bounds and integer", () => {
    expect(() => parseReasoning({ budgetTokens: 0 } as any)).toThrow(/between/);
    expect(() => parseReasoning({ budgetTokens: -5 } as any)).toThrow(/between/);
    expect(() => parseReasoning({ budgetTokens: 0.5 } as any)).toThrow(/integer/);
    expect(() => parseReasoning({ budgetTokens: "12000" } as any)).toThrow(/integer/);
    expect(() => parseReasoning({ budgetTokens: REASONING_BUDGET_MAX_TOKENS + 1 } as any)).toThrow(/between/);
    expect(() => parseReasoning({ reasoning: { budgetTokens: -1 } } as any)).toThrow(/between/);
    expect(parseReasoning({ budgetTokens: REASONING_BUDGET_MIN_TOKENS } as any)).toEqual({ mode: "budget", budgetTokens: REASONING_BUDGET_MIN_TOKENS });
    expect(parseReasoning({ budgetTokens: REASONING_BUDGET_MAX_TOKENS } as any)).toEqual({ mode: "budget", budgetTokens: REASONING_BUDGET_MAX_TOKENS });
  });
  it("rejects invalid adaptive levels", () => {
    expect(() => parseReasoning({ reasoning: "invalid" } as any)).toThrow(/Invalid reasoning/);
    expect(() => parseReasoning({ reasoning_effort: "invalid" } as any)).toThrow(/Invalid reasoning_effort/);
  });
});

describe("resolveReasoning", () => {
  it("maps adaptive and none", () => {
    expect(resolveReasoning({ mode: "adaptive", level: "high" })).toEqual({ reasoning: "high" });
    expect(resolveReasoning({ mode: "none" })).toEqual({ reasoning: "none" });
  });
  it("budget returns empty portable", () => {
    expect(resolveReasoning({ mode: "budget", budgetTokens: 12000 })).toEqual({});
  });
});

describe("buildProviderOptionsForReasoning", () => {
  it("builds anthropic budget", () => {
    expect(buildProviderOptionsForReasoning("anthropic", { mode: "budget", budgetTokens: 5000 }, {}))
      .toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: 5000 } } });
  });
  it("builds google budget", () => {
    expect(buildProviderOptionsForReasoning("google", { mode: "budget", budgetTokens: 3000 }, {}))
      .toEqual({ google: { thinkingConfig: { thinkingBudget: 3000 } } });
  });
  it("returns undefined for unsupported providers (openai, generic)", () => {
    expect(buildProviderOptionsForReasoning("openai", { mode: "budget", budgetTokens: 5000 }, {})).toBeUndefined();
    expect(buildProviderOptionsForReasoning("groq", { mode: "budget", budgetTokens: 5000 }, {})).toBeUndefined();
    expect(buildProviderOptionsForReasoning("openai", { mode: "adaptive", level: "high" }, {})).toBeUndefined();
  });
});

describe("isBudgetSupported", () => {
  it("only anthropic and google support exact budget", () => {
    expect(isBudgetSupported("anthropic")).toBe(true);
    expect(isBudgetSupported("google")).toBe(true);
    expect(isBudgetSupported("openai")).toBe(false);
    expect(isBudgetSupported("groq")).toBe(false);
    expect(isBudgetSupported("fal")).toBe(false);
  });
});

describe("reasoning unsupported handling", () => {
  it("openai and third-party chat should reject budget", async () => {
    const { openAIChat } = await import("../src/providers/openai/sdk.ts");
    const { thirdPartyChat } = await import("../src/providers/third-party/common.ts");
    await expect(openAIChat({ body: {} as never, apiKey: "k", provider: { id: "openai", baseUrl: "https://api.openai.com/v1", protocol: "openai-completions" as never }, model: { id: "gpt-4" } as never, signal: undefined as never, reasoning: { mode: "budget", budgetTokens: 5000 } })).rejects.toThrow(/does not support exact budget/);
    await expect(thirdPartyChat("groq", { body: {} as never, apiKey: "k", provider: { id: "groq", baseUrl: "https://api.groq.com/openai/v1", protocol: "openai-completions" as never }, model: { id: "llama" } as never, signal: undefined as never, reasoning: { mode: "budget", budgetTokens: 5000 } } as never)).rejects.toThrow(/does not support exact budget/);
  });
});

describe("mapFinishReason", () => {
  it("maps known reasons", () => {
    expect(mapFinishReason("length")).toBe("length");
    expect(mapFinishReason("MAX_TOKENS")).toBe("length");
    expect(mapFinishReason("tool_calls")).toBe("tool_calls");
    expect(mapFinishReason("content_filter")).toBe("content_filter");
    expect(mapFinishReason(undefined)).toBe("stop");
  });
});

describe("normalizeMessagesForSDK", () => {
  it("passes string content", () => {
    expect(normalizeMessagesForSDK([{ role: "user", content: "hi" } as any])).toEqual([{ role: "user", content: "hi" }]);
  });
  it("converts data URL to file part", () => {
    const out = normalizeMessagesForSDK([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } }] } as any]);
    expect((out[0] as any).content[0]).toEqual({ type: "file", data: "abc", mediaType: "image/png" });
  });
  it("converts https url to image part", () => {
    const out = normalizeMessagesForSDK([{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] } as any]);
    expect((out[0] as any).content[0]).toEqual({ type: "image", image: "https://example.com/a.png" });
  });
});
