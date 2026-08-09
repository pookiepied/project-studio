import { describe, it, expect, vi } from "vitest";
import { createTavilySearchProvider } from "../../src/providers/search/tavily/client.js";

describe("tavily search provider", () => {
  it("maps results correctly", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ title: "T", url: "https://t.com", content: "c", score: 0.9 }], request_id: "r1" }), { status: 200 }),
    ) as unknown as typeof fetch;

    const p = createTavilySearchProvider("key");
    const res = await p.search({ query: "hi", max_results: 1 });
    expect(res.results[0].score).toBe(0.9);
    expect(res.requestId).toBe("r1");

    globalThis.fetch = orig;
  });
});
