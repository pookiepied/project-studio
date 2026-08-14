import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { encrypt } from "../src/infra/encryption.ts";
import { chatRoute } from "../src/routes/v1/chat.ts";
import { imagesRoute } from "../src/routes/v1/images.ts";
import { audioRoute } from "../src/routes/v1/audio.ts";
import { embeddingsRoute } from "../src/routes/v1/embeddings.ts";
import { videosRoute } from "../src/routes/v1/videos.ts";
import { modelsRoute } from "../src/routes/v1/models.ts";
import { responsesRoute } from "../src/routes/v1/responses.ts";
import { documentsRoute } from "../src/routes/v1/documents.ts";

const CRED_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 bytes base64 (all zero for test)
// Valid base64 32 bytes: 32 bytes = 44 base64 chars with padding; use 32 zero bytes
const TEST_KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32)));

async function createTestDb(options: {
  models?: Array<Record<string, unknown>>;
  providers?: Array<Record<string, unknown>>;
  credentials?: Array<{ provider_id: string; encrypted_key: string }>;
  gatewayKeys?: Array<Record<string, unknown>>;
} = {}) {
  const providers = options.providers ?? [
    { id: "openai", name: "OpenAI", base_url: "https://api.openai.com/v1", protocol: "openai-completions", auth_mode: "apiKey", enabled: 1, created_at: Date.now(), updated_at: Date.now() },
    { id: "anthropic", name: "Anthropic", base_url: "https://api.anthropic.com", protocol: "anthropic-messages", auth_mode: "apiKey", enabled: 1, created_at: Date.now(), updated_at: Date.now() },
  ];
  const models = options.models ?? [
    { provider_id: "openai", model_id: "gpt-4o", display_name: "GPT-4o", category: "text", input_modalities: '["text"]', output_modalities: '["text"]', context_window: 128000, max_output_tokens: 4096, pricing_input: null, pricing_output: null, pricing_cache_read: null, pricing_cache_write: null, supports_tools: 1, supports_parallel_tools: 1, supports_vision: 0, supports_reasoning: 0, reasoning_type: null, reasoning_levels: null, family: null, lab: null, open_weights: 0, knowledge_cutoff: null, catalog_source: "test", enabled: 1, exposed: 1, raw_json: null, fetched_at: Date.now(), updated_at: Date.now() },
    { provider_id: "openai", model_id: "text-embedding-3-small", display_name: "Embed", category: "embedding", input_modalities: '["text"]', output_modalities: '["text"]', context_window: 8192, max_output_tokens: null, pricing_input: null, pricing_output: null, pricing_cache_read: null, pricing_cache_write: null, supports_tools: 0, supports_parallel_tools: 0, supports_vision: 0, supports_reasoning: 0, reasoning_type: null, reasoning_levels: null, family: null, lab: null, open_weights: 0, knowledge_cutoff: null, catalog_source: "test", enabled: 1, exposed: 1, raw_json: null, fetched_at: Date.now(), updated_at: Date.now() },
    { provider_id: "openai", model_id: "dall-e-3", display_name: "DallE", category: "image", input_modalities: '["text"]', output_modalities: '["image"]', context_window: null, max_output_tokens: null, pricing_input: null, pricing_output: null, pricing_cache_read: null, pricing_cache_write: null, supports_tools: 0, supports_parallel_tools: 0, supports_vision: 0, supports_reasoning: 0, reasoning_type: null, reasoning_levels: null, family: null, lab: null, open_weights: 0, knowledge_cutoff: null, catalog_source: "test", enabled: 1, exposed: 1, raw_json: null, fetched_at: Date.now(), updated_at: Date.now() },
    { provider_id: "openai", model_id: "whisper-1", display_name: "Whisper", category: "transcription", input_modalities: '["audio"]', output_modalities: '["text"]', context_window: null, max_output_tokens: null, pricing_input: null, pricing_output: null, pricing_cache_read: null, pricing_cache_write: null, supports_tools: 0, supports_parallel_tools: 0, supports_vision: 0, supports_reasoning: 0, reasoning_type: null, reasoning_levels: null, family: null, lab: null, open_weights: 0, knowledge_cutoff: null, catalog_source: "test", enabled: 1, exposed: 1, raw_json: null, fetched_at: Date.now(), updated_at: Date.now() },
    { provider_id: "openai", model_id: "tts-1", display_name: "TTS", category: "speech", input_modalities: '["text"]', output_modalities: '["audio"]', context_window: null, max_output_tokens: null, pricing_input: null, pricing_output: null, pricing_cache_read: null, pricing_cache_write: null, supports_tools: 0, supports_parallel_tools: 0, supports_vision: 0, supports_reasoning: 0, reasoning_type: null, reasoning_levels: null, family: null, lab: null, open_weights: 0, knowledge_cutoff: null, catalog_source: "test", enabled: 1, exposed: 1, raw_json: null, fetched_at: Date.now(), updated_at: Date.now() },
  ];
  const creds = options.credentials ?? [];
  // If no creds provided, create encrypted cred for openai
  if (creds.length === 0) {
    const enc = await encrypt("sk-test-openai", TEST_KEY_B64);
    creds.push({ provider_id: "openai", encrypted_key: enc });
  }
  const gatewayKeys = options.gatewayKeys ?? [];

  const db: D1Database = {
    prepare(sql: string) {
      const stmt: Record<string, unknown> = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...args: unknown[]) { (stmt as { _args: unknown[] })._args = args; return stmt as unknown as D1PreparedStatement; },
        first: async <T>() => {
          const args = (stmt as { _args: unknown[] })._args as unknown[];
          if (sql.includes("FROM gateway_keys") && sql.includes("key_hash")) {
            return null as T;
          }
          if (sql.includes("COUNT(*)") && sql.includes("gateway_keys")) {
            return { cnt: gatewayKeys.length } as T;
          }
          if (sql.includes("FROM providers WHERE id = ?")) {
            const id = args[0] as string;
            return (providers.find((p) => p.id === id) ?? null) as T;
          }
          if (sql.includes("FROM provider_credentials WHERE provider_id")) {
            const pid = args[0] as string;
            return (creds.find((c) => c.provider_id === pid) ?? null) as T;
          }
          if (sql.includes("FROM models") && sql.includes("model_id = ?") && sql.includes("exposed = 1")) {
            const mid = args[0] as string;
            // findExposedModel: look for model_id with exposed=1
            const found = models.find((m) => m.model_id === mid && m.exposed === 1);
            return (found ?? null) as T;
          }
          if (sql.includes("SELECT 1 FROM models WHERE model_id = ?")) {
            const mid = args[0] as string;
            return (models.find((m) => m.model_id === mid) ? { "1": 1 } : null) as T;
          }
          if (sql.includes("SELECT * FROM models WHERE provider_id = ? AND model_id = ?")) {
            const pid = args[0] as string, mid = args[1] as string;
            return (models.find((m) => m.provider_id === pid && m.model_id === mid) ?? null) as T;
          }
          if (sql.includes("SELECT model_id, exposed, enabled FROM models")) {
            const pid = args[0] as string, mid = args[1] as string;
            const row = models.find((m) => m.provider_id === pid && m.model_id === mid);
            if (row) return { model_id: row.model_id, exposed: row.exposed, enabled: row.enabled } as T;
            return null as T;
          }
          return null as T;
        },
        all: async <T>() => {
          const args = (stmt as { _args: unknown[] })._args as unknown[];
          if (sql.includes("FROM models") && sql.includes("model_id = ?") && sql.includes("exposed = 1")) {
            const mid = args[0] as string;
            const filtered = models.filter((m) => m.model_id === mid && m.exposed === 1);
            return { results: filtered } as T;
          }
          if (sql.includes("FROM models") && sql.includes("exposed = 1")) {
            const filtered = models.filter((m) => m.exposed === 1);
            return { results: filtered } as T;
          }
          if (sql.includes("FROM providers")) {
            return { results: providers } as T;
          }
          return { results: [] } as T;
        },
        run: async () => ({ meta: { changes: 1 } } as never),
      };
      return stmt as unknown as D1PreparedStatement;
    },
    batch: async (stmts: D1PreparedStatement[]) => {
      for (const s of stmts) await (s as unknown as { run: () => Promise<unknown> }).run();
      return stmts.map(() => ({ meta: { changes: 1 } })) as never;
    },
  } as unknown as D1Database;
  return db;
}

describe("Routes integration", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("GET /v1/models returns exposed models", async () => {
    const db = await createTestDb();
    const app = new Hono<{ Bindings: { DB: D1Database; CREDENTIAL_ENCRYPTION_KEY: string; ENVIRONMENT: string } }>();
    app.route("/v1", modelsRoute);
    const { errorHandler } = await import("../src/middleware/errorHandler.ts");
    app.onError((err, c) => errorHandler(err as Error, c as never));
    const res = await app.request("/v1/models", { method: "GET" }, { DB: db, CREDENTIAL_ENCRYPTION_KEY: TEST_KEY_B64, ENVIRONMENT: "development" } as never);
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data.length).toBeGreaterThan(0);
  });

  it("POST /v1/chat/completions requires model and handles unknown model", async () => {
    const db = await createTestDb();
    const app = new Hono();
    app.route("/v1", chatRoute);
    const { errorHandler } = await import("../src/middleware/errorHandler.ts");
    app.onError((err, c) => errorHandler(err as Error, c as never));
    const res1 = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }, { DB: db, CREDENTIAL_ENCRYPTION_KEY: TEST_KEY_B64, ENVIRONMENT: "development" } as never);
    expect(res1.status).toBe(400);
    const res2 = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "nonexistent", messages: [{ role: "user", content: "hi" }] }) }, { DB: db, CREDENTIAL_ENCRYPTION_KEY: TEST_KEY_B64, ENVIRONMENT: "development" } as never);
    expect(res2.status).toBe(404);
  });

  it("POST /v1/embeddings requires input", async () => {
    const db = await createTestDb();
    const app = new Hono();
    app.route("/v1", embeddingsRoute);
    const { errorHandler } = await import("../src/middleware/errorHandler.ts");
    app.onError((err, c) => errorHandler(err as Error, c as never));
    const res = await app.request("/v1/embeddings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "text-embedding-3-small" }) }, { DB: db, CREDENTIAL_ENCRYPTION_KEY: TEST_KEY_B64, ENVIRONMENT: "development" } as never);
    expect(res.status).toBe(400);
  });

  it("POST /v1/images/generations requires prompt", async () => {
    const db = await createTestDb();
    const app = new Hono();
    app.route("/v1", imagesRoute);
    const { errorHandler } = await import("../src/middleware/errorHandler.ts");
    app.onError((err, c) => errorHandler(err as Error, c as never));
    // Mock provider runtime to avoid real fetch
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: "abc" }] }), { status: 200 })));
    const res = await app.request("/v1/images/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "dall-e-3" }) }, { DB: db, CREDENTIAL_ENCRYPTION_KEY: TEST_KEY_B64, ENVIRONMENT: "development" } as never);
    expect(res.status).toBe(400);
  });

  it("POST /v1/audio/speech requires input", async () => {
    const db = await createTestDb();
    const app = new Hono();
    app.route("/v1", audioRoute);
    const { errorHandler } = await import("../src/middleware/errorHandler.ts");
    app.onError((err, c) => errorHandler(err as Error, c as never));
    const res = await app.request("/v1/audio/speech", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "tts-1" }) }, { DB: db, CREDENTIAL_ENCRYPTION_KEY: TEST_KEY_B64, ENVIRONMENT: "development" } as never);
    expect(res.status).toBe(400);
  });

  it("POST /v1/videos/generations requires prompt", async () => {
    const db = await createTestDb({
      models: [
        { provider_id: "fal", model_id: "fal-ai/kling-video", display_name: "Kling", category: "video", input_modalities: '["text"]', output_modalities: '["video"]', context_window: null, max_output_tokens: null, pricing_input: null, pricing_output: null, pricing_cache_read: null, pricing_cache_write: null, supports_tools: 0, supports_parallel_tools: 0, supports_vision: 1, supports_reasoning: 0, reasoning_type: null, reasoning_levels: null, family: null, lab: null, open_weights: 0, knowledge_cutoff: null, catalog_source: "test", enabled: 1, exposed: 1, raw_json: null, fetched_at: Date.now(), updated_at: Date.now() },
      ],
      providers: [{ id: "fal", name: "Fal", base_url: "https://api.fal.ai/v1", protocol: "openai-completions", auth_mode: "apiKey", enabled: 1, created_at: Date.now(), updated_at: Date.now() }],
    });
    // Need to add credential for fal
    const enc = await encrypt("sk-fal", TEST_KEY_B64);
    const db2 = await createTestDb({
      models: [
        { provider_id: "fal", model_id: "fal-ai/kling-video", display_name: "Kling", category: "video", input_modalities: '["text"]', output_modalities: '["video"]', context_window: null, max_output_tokens: null, pricing_input: null, pricing_output: null, pricing_cache_read: null, pricing_cache_write: null, supports_tools: 0, supports_parallel_tools: 0, supports_vision: 1, supports_reasoning: 0, reasoning_type: null, reasoning_levels: null, family: null, lab: null, open_weights: 0, knowledge_cutoff: null, catalog_source: "test", enabled: 1, exposed: 1, raw_json: null, fetched_at: Date.now(), updated_at: Date.now() },
      ],
      providers: [{ id: "fal", name: "Fal", base_url: "https://api.fal.ai/v1", protocol: "openai-completions", auth_mode: "apiKey", enabled: 1, created_at: Date.now(), updated_at: Date.now() }],
      credentials: [{ provider_id: "fal", encrypted_key: enc }],
    });
    const app = new Hono();
    app.route("/v1", videosRoute);
    const { errorHandler } = await import("../src/middleware/errorHandler.ts");
    app.onError((err, c) => errorHandler(err as Error, c as never));
    const res = await app.request("/v1/videos/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "fal-ai/kling-video" }) }, { DB: db2, CREDENTIAL_ENCRYPTION_KEY: TEST_KEY_B64, ENVIRONMENT: "development" } as never);
    expect(res.status).toBe(400);
  });

  it("POST /v1/documents/preprocess requires file", async () => {
    const db = await createTestDb();
    const app = new Hono();
    app.route("/v1", documentsRoute);
    const { errorHandler } = await import("../src/middleware/errorHandler.ts");
    app.onError((err, c) => errorHandler(err as Error, c as never));
    const res = await app.request("/v1/documents/preprocess", { method: "POST" }, { DB: db, CREDENTIAL_ENCRYPTION_KEY: TEST_KEY_B64, ENVIRONMENT: "development" } as never);
    expect(res.status).toBe(400);
  });

  it("POST /v1/responses requires model", async () => {
    const db = await createTestDb();
    const app = new Hono();
    app.route("/v1", responsesRoute);
    const { errorHandler } = await import("../src/middleware/errorHandler.ts");
    app.onError((err, c) => errorHandler(err as Error, c as never));
    const res = await app.request("/v1/responses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }, { DB: db, CREDENTIAL_ENCRYPTION_KEY: TEST_KEY_B64, ENVIRONMENT: "development" } as never);
    expect(res.status).toBe(400);
  });
});
