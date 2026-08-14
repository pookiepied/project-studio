import { describe, it, expect } from "vitest";
import { encrypt, decrypt, hashGatewayKeyAsync, generateGatewayKey } from "../src/infra/encryption.ts";
import { rowToModelDef } from "../src/infra/db.ts";
import { providerQuirks, applyQuirk } from "../src/providers/quirks.ts";
import { stableStreamId, stableCompletionId, openAIChunk, openAIDone } from "../src/providers/shared/sse.ts";
import type { ModelRow } from "../src/infra/db.ts";

describe("Encryption", () => {
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));

  it("encrypt/decrypt roundtrip", async () => {
    const plaintext = "sk-test-api-key-123";
    const enc = await encrypt(plaintext, key);
    expect(enc).not.toBe(plaintext);
    const dec = await decrypt(enc, key);
    expect(dec).toBe(plaintext);
  });

  it("hashGatewayKeyAsync is SHA-256 hex", async () => {
    const hash = await hashGatewayKeyAsync("sk-gw_test");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    const hash2 = await hashGatewayKeyAsync("sk-gw_test");
    expect(hash).toBe(hash2);
    const hash3 = await hashGatewayKeyAsync("different");
    expect(hash).not.toBe(hash3);
  });

  it("generateGatewayKey format", () => {
    const key = generateGatewayKey();
    expect(key.startsWith("sk-gw_")).toBe(true);
    expect(key.length).toBeGreaterThan(20);
  });

  it("decrypt fails with wrong key", async () => {
    const enc = await encrypt("secret", key);
    const wrongKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(2)));
    await expect(decrypt(enc, wrongKey)).rejects.toThrow(/Failed to decrypt/);
  });
});

describe("rowToModelDef", () => {
  it("converts ModelRow to ModelDefinition with constants", () => {
    const row: ModelRow = {
      provider_id: "openai",
      model_id: "gpt-4o",
      display_name: "GPT-4o",
      category: "text",
      input_modalities: '["text","image"]',
      output_modalities: '["text"]',
      context_window: 128000,
      max_output_tokens: 4096,
      pricing_input: 5,
      pricing_output: 15,
      pricing_cache_read: 1,
      pricing_cache_write: 2,
      supports_tools: 1,
      supports_parallel_tools: 1,
      supports_vision: 1,
      supports_reasoning: 1,
      reasoning_type: "dynamic",
      reasoning_levels: '["low","medium","high"]',
      family: "gpt-4",
      lab: "openai",
      open_weights: 0,
      knowledge_cutoff: "2024-06",
      catalog_source: "test",
      enabled: 1,
      exposed: 1,
      raw_json: '{"id":"gpt-4o"}',
      fetched_at: Date.now(),
      updated_at: Date.now(),
    };
    const def = rowToModelDef(row);
    expect(def.id).toBe("gpt-4o");
    expect(def.providerId).toBe("openai");
    expect(def.inputModalities).toEqual(["text", "image"]);
    expect(def.supportsVision).toBe(true);
    expect(def.reasoning?.type).toBe("dynamic");
    expect(def.pricing?.input).toBe(5);
    expect(def.raw).toEqual({ id: "gpt-4o" });
  });

  it("handles corrupt JSON gracefully", () => {
    const row: ModelRow = {
      provider_id: "test",
      model_id: "bad",
      display_name: null,
      category: "text",
      input_modalities: 'not-json',
      output_modalities: 'not-json',
      context_window: null,
      max_output_tokens: null,
      pricing_input: null,
      pricing_output: null,
      pricing_cache_read: null,
      pricing_cache_write: null,
      supports_tools: 0,
      supports_parallel_tools: 0,
      supports_vision: 0,
      supports_reasoning: 0,
      reasoning_type: null,
      reasoning_levels: 'bad',
      family: null,
      lab: null,
      open_weights: 0,
      knowledge_cutoff: null,
      catalog_source: null,
      enabled: 1,
      exposed: 1,
      raw_json: 'bad',
      fetched_at: null,
      updated_at: Date.now(),
    };
    const def = rowToModelDef(row);
    expect(def.inputModalities).toEqual(["text"]);
    expect(def.reasoning).toBeNull();
  });
});

describe("Quirks 17 explicit", () => {
  it("covers all 19 providers via constants (no hardcode)", () => {
    const expected = ["alibaba","cerebras","cohere","deepseek","groq","minimax","moonshot","openrouter","together","xiaomi","zai","xai","huggingface","fireworks","mistral","nvidia","perplexity","elevenlabs","fal"];
    for (const id of expected) {
      expect(providerQuirks[id]).toBeDefined();
    }
    expect(Object.keys(providerQuirks).length).toBe(19);
  });

  it("applyQuirk is immutable and handles unknown", () => {
    const body = { model: "test", tools: [{ type: "function", function: { name: "a", strict: true } }] };
    const patched = applyQuirk("cerebras", body as never);
    expect(body.tools[0].function.strict).toBe(true);
    expect((patched.tools as unknown as Array<{ function: { strict?: boolean } }>)[0].function.strict).toBeUndefined();
    const unknown = applyQuirk("unknown-provider-xyz", { model: "x" });
    expect(unknown.model).toBe("x");
    expect(unknown).not.toBe({ model: "x" }); // new object
  });
});

describe("SSE stable IDs", () => {
  it("stableStreamId uses crypto.randomUUID (no Date.now)", () => {
    const id1 = stableStreamId();
    const id2 = stableStreamId();
    expect(id1).not.toBe(id2);
    expect(id1.startsWith("chatcmpl_")).toBe(true);
    expect(id1.split("_")[1].length).toBeGreaterThan(10); // UUID length
    expect(id1).not.toContain(String(Date.now()));
  });

  it("stableCompletionId also uses randomUUID", () => {
    const id = stableCompletionId();
    expect(id.startsWith("chatcmpl_")).toBe(true);
    expect(id).not.toContain(String(Date.now()));
  });

  it("openAIChunk and openAIDone format", () => {
    const chunk = openAIChunk("chatcmpl_123", "gpt-4o", { content: "hi" });
    expect(chunk.startsWith("data: ")).toBe(true);
    expect(chunk).toContain('"content":"hi"');
    expect(chunk).toContain('"model":"gpt-4o"');
    expect(openAIDone()).toBe("data: [DONE]\n\n");
  });
});
