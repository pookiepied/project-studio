import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../src/server/handler.js";

function makeEnv() {
  return {
    TAVILY_API_KEY: "tvly-test",
    JINA_API_KEY: "jina-test",
    BRAVE_API_KEY: "brave-test",
    SEARCH_PRIMARY: "tavily",
    SEARCH_FALLBACK: "brave",
    FETCH_PRIMARY: "jina",
    FETCH_FALLBACK: "tavily",
    MCP_SERVER_NAME: "studio-web",
    MCP_SERVER_VERSION: "0.1.0",
  };
}

describe("mcp integration — handler", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("GET /health is reachable", async () => {
    const req = new Request("http://localhost/health");
    const res = await app.fetch(req, makeEnv() as unknown as Record<string, string>);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean };
    expect(j.ok).toBe(true);
  });

  it("POST /mcp tools/list returns search and fetch", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body,
    });
    const res = await app.fetch(req, makeEnv() as unknown as Record<string, string>);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(json.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["search", "fetch"]));
  });

  it("POST /mcp tools/call search returns normalized result", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ title: "Hello", url: "https://example.com", content: "world", score: 0.9 }], request_id: "r1" }), { status: 200 }),
    ) as unknown as typeof fetch;

    const body = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search", arguments: { query: "test", max_results: 1 } } });
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body,
    });
    const res = await app.fetch(req, makeEnv() as unknown as Record<string, string>);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: { content: Array<{ text: string }> } };
    const text = json.result.content[0].text;
    const parsed = JSON.parse(text) as { provider: string; results: unknown[] };
    expect(parsed.provider).toBe("tavily");

    globalThis.fetch = orig;
  });
});
