import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeFetch } from "../../src/runtime/fetch/execute.js";
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

describe("fetch runtime", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => (globalThis.fetch = originalFetch));

  it("bounds content via max_chars/offset", async () => {
    const big = "a".repeat(50000);
    globalThis.fetch = vi.fn(async () => new Response(big, { status: 200, headers: { "content-type": "text/markdown" } })) as unknown as typeof fetch;

    const res = await executeFetch({ url: "https://example.com", max_chars: 20000, offset: 0 }, cfg);
    expect(res.content.length).toBe(20000);
    expect(res.has_more).toBe(true);
    expect(res.next_offset).toBe(20000);
    expect(res.metadata).toBeDefined();
  });

  it("falls back to tavily extract when jina fails", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo) => {
      call++;
      const url = String(input);
      if (url.includes("r.jina.ai")) return new Response("error", { status: 500 });
      // tavily extract
      return new Response(JSON.stringify({ results: [{ url: "https://example.com", content: "extracted content", title: "Example" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await executeFetch({ url: "https://example.com" }, cfg);
    expect(res.provider).toBe("tavily");
    expect(res.content).toContain("extracted");
  });

  it("rejects private IP", async () => {
    await expect(executeFetch({ url: "http://127.0.0.1/secret" }, cfg)).rejects.toThrow(/Private|not allowed/i);
  });
});
