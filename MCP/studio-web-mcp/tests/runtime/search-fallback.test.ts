import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeSearch } from "../../src/runtime/search/execute.js";
import type { ProviderConfig } from "../../src/config/env.js";

const cfg: ProviderConfig = {
  searchPrimary: "tavily",
  searchFallback: "brave",
  fetchPrimary: "jina",
  fetchFallback: "tavily",
  tavilyKey: "tvly-test",
  braveKey: "brave-test",
  jinaKey: "jina-test",
};

describe("search runtime fallback", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => (globalThis.fetch = originalFetch));

  it("returns primary when ok", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ title: "A", url: "https://a.com", content: "hello" }], request_id: "req1" }), { status: 200 }),
    ) as unknown as typeof fetch;

    const res = await executeSearch({ query: "test" }, cfg);
    expect(res.provider).toBe("tavily");
    expect(res.results[0].title).toBe("A");
  });

  it("falls back to brave on 429", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      if (call === 1) return new Response("rate limited", { status: 429 });
      // brave response
      return new Response(JSON.stringify({ web: { results: [{ title: "B", url: "https://b.com", description: "fallback content" }] } }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await executeSearch({ query: "test" }, cfg);
    expect(res.provider).toBe("brave");
    expect(res.results[0].title).toBe("B");
  });

  it("throws without fallback on 401", async () => {
    globalThis.fetch = vi.fn(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    await expect(executeSearch({ query: "test" }, cfg)).rejects.toThrow();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // no fallback
  });
});
