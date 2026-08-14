import { describe, expect, it, vi } from "vitest";
import { applyQuirk } from "../src/providers/quirks.ts";
import { getProviderAdapter } from "../src/providers/registry.ts";
import { openAIResponsesAdapter } from "../src/adapters/openai-responses/adapter.ts";

describe("provider compatibility", () => {
  it("does not mutate the caller body while stripping unsupported tool strictness", () => {
    const body = {
      model: "llama",
      tools: [{ type: "function", function: { name: "lookup", strict: true } }],
    };

    const patched = applyQuirk("cerebras", body);

    expect(body.tools[0].function.strict).toBe(true);
    expect((patched.tools as Array<{ function: Record<string, unknown> }>)[0].function.strict).toBeUndefined();
  });

  it("applies quirks via canonical SDK path (common.ts), not via legacy adapter", async () => {
    // Legacy adapter path is deprecated — withProviderQuirk is now no-op for SDK providers
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = getProviderAdapter("cerebras", "openai-completions");
    await adapter.chat("key", "https://api.example.test/v1", {
      model: "llama",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "lookup", strict: true } }],
    }, new AbortController().signal);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const sentViaAdapter = JSON.parse(String(request.body));
    // Adapter no longer strips — canonical path is thirdPartyChat → applyQuirk
    expect(sentViaAdapter.tools[0].function.strict).toBe(true);

    // Canonical SDK path does strip via applyQuirk before translation
    const { applyQuirk } = await import("../src/providers/quirks.ts");
    const patched = applyQuirk("cerebras", {
      model: "llama",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "lookup", strict: true } }],
    });
    expect((patched.tools as Array<{ function: Record<string, unknown> }>)[0].function.strict).toBeUndefined();
  });
});

describe("OpenAI Responses discovery", () => {
  it("does not overclaim vision or reasoning for every discovered model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: "plain-chat", created: 1, owned_by: "test" },
        { id: "gpt-5", created: 2, owned_by: "test" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const models = await openAIResponsesAdapter.discover("key", "https://api.example.test/v1");

    expect(models).toHaveLength(2);
    expect(models[0]?.supportsVision).toBe(false);
    expect(models[0]?.supportsReasoning).toBe(false);
    expect(models[1]?.supportsReasoning).toBe(true);
  });
});
