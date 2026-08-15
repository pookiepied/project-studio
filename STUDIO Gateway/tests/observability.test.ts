import { describe, expect, it } from "vitest";
import { finalizeRequestTelemetry, startRequestTelemetry } from "../src/observability/request.ts";

describe("request telemetry", () => {
  it("creates a stable request id and captures normalized usage and cost", async () => {
    let state: unknown;
    const headers = new Headers();
    const context = {
      req: { method: "POST", path: "/v1/chat/completions", header: () => undefined },
      set: (_key: string, value: unknown) => { state = value; },
      header: (key: string, value: string) => headers.set(key, value),
    };
    const request = startRequestTelemetry(context as never);
    expect(request.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(headers.get("X-Request-ID")).toBe(request.requestId);
    expect(state).toBe(request);

    const calls: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              first: async () => sql.includes("FROM models") ? {
                provider_id: "openai",
                category: "text",
                pricing_input: 1,
                pricing_output: 2,
                pricing_cache_read: 0.5,
                pricing_cache_write: null,
              } : null,
              run: async () => { calls.push({ sql, args }); },
            };
          },
        };
      },
    } as unknown as D1Database;
    request.modelId = "gpt-test";
    request.gatewayKeyId = "key-1";
    request.routingLatencyMs = 10;
    request.startedAt = Date.now() - 1_010;
    const response = new Response(JSON.stringify({
      id: "gen-1",
      choices: [{ finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cached_tokens: 20 },
    }), { headers: { "content-type": "application/json" } });
    await finalizeRequestTelemetry(db, request, response);

    const insert = calls.find((call) => call.sql.includes("INSERT OR REPLACE"));
    expect(insert).toBeDefined();
    expect(insert?.args).toContain("gen-1");
    expect(insert?.args).toContain(1);
    expect(insert?.args).toContain(0.00019);
  });
});
