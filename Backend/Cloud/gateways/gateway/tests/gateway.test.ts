import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { getTransport } from "../src/core/transport";
import type { GatewayEnv } from "../src/system/infrastructure/cloudflare/env";
import {
  embed,
  experimental_generateSpeech,
  experimental_generateVideo,
  experimental_transcribe,
  generateImage,
  generateText,
  streamText
} from "ai";

vi.mock("ai", () => ({
  embed: vi.fn(),
  embedMany: vi.fn(),
  experimental_generateSpeech: vi.fn(),
  experimental_generateVideo: vi.fn(),
  experimental_transcribe: vi.fn(),
  generateImage: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
  // Structured-output helpers used by the provider chat handlers.
  Output: { object: vi.fn((spec: unknown) => ({ __output: spec })) },
  jsonSchema: vi.fn((schema: unknown) => schema)
}));

function createKv(): KVNamespace {
  const values = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const value = values.get(key) ?? null;
      return type === "json" && value ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null }))
  } as unknown as KVNamespace;
}

function createEnv(): GatewayEnv {
  return {
    CF_ACCOUNT_ID: "account-123",
    CF_AIG_GATEWAY_NAME: "studio-gateway",
    CF_AIG_BYOK_ALIAS: "production",
    CF_AIG_TOKEN: "cf-token",
    CREDITS_KV: createKv(),
    MODEL_REGISTRY_KV: createKv()
  };
}

function mockModelsFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: []
      })
    )
  );
}

async function postChat(env: GatewayEnv, body: unknown) {
  return worker.fetch(
    new Request("https://gateway.test/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    env,
    {} as ExecutionContext
  );
}

async function postJson(env: GatewayEnv, path: string, body: unknown) {
  return worker.fetch(
    new Request(`https://gateway.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    env,
    {} as ExecutionContext
  );
}

describe("gateway worker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    mockModelsFetch();
  });

  it("builds the worker surface and responds to /health", async () => {
    const response = await worker.fetch(new Request("https://gateway.test/health"), createEnv(), {} as ExecutionContext);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("serves /v1/models from the gateway catalog shape", async () => {
    const response = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      createEnv(),
      {} as ExecutionContext
    );
    const body = (await response.json()) as { data: Array<{ id: string }> };
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ object: "list" });
    expect(body.data.some((model: { id: string }) => model.id === "openai:gpt-5.6-sol")).toBe(true);
  });

  it("handles a non-streaming chat completion", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hello from OpenAI",
      finishReason: "stop",
      usage: { inputTokens: 4, outputTokens: 5 },
      toolCalls: []
    } as never);

    const response = await postChat(createEnv(), {
      model: "gpt-5.6-sol",
      messages: [{ role: "user", content: "Say hello" }]
    });

    const body = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    expect(response.status).toBe(200);
    expect(body.choices[0].message.content).toBe("hello from OpenAI");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("streams chat completions as SSE", async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "hel" };
        yield { type: "text-delta", text: "lo" };
      })()
    } as never);

    const response = await postChat(createEnv(), {
      model: "gpt-5.6-sol",
      stream: true,
      messages: [{ role: "user", content: "Say hello" }]
    });

    const text = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("hel");
    expect(text).toContain("[DONE]");
  });

  it("passes tool calls through the chat response", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "",
      finishReason: "tool-calls",
      usage: {},
      toolCalls: [{ toolName: "lookup", input: { q: "weather" } }]
    } as never);

    const response = await postChat(createEnv(), {
      model: "gpt-5.6-sol",
      messages: [{ role: "user", content: "Use a tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            parameters: { type: "object", properties: { q: { type: "string" } } }
          }
        }
      ]
    });

    const body = (await response.json()) as { choices: Array<{ message: { tool_calls: unknown[] } }> };
    expect(response.status).toBe(200);
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
  });

  it("accepts vision input for a vision-capable model", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "that is an image",
      finishReason: "stop",
      usage: {},
      toolCalls: []
    } as never);

    const response = await postChat(createEnv(), {
      model: "gpt-5.6-sol",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" }
          ]
        }
      ]
    });

    expect(response.status).toBe(200);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("rejects unsupported capabilities before calling the provider", async () => {
    const response = await postChat(createEnv(), {
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" }
          ]
        }
      ]
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("rejects unsupported reasoning effort values before calling the provider", async () => {
    const response = await postChat(createEnv(), {
      model: "gpt-5.6-luna",
      reasoningEffort: "minimal",
      messages: [{ role: "user", content: "Think carefully" }]
    });

    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(body.error.message).toContain("minimal");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("marks exact reviewed reasoning metadata in the model catalog", async () => {
    const response = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      createEnv(),
      {} as ExecutionContext
    );
    const body = (await response.json()) as { data: Array<{ id: string; capabilities: { chat?: unknown } }> };
    const gpt55 = body.data.find((model) => model.id === "openai:gpt-5.5") as {
      capabilities: { chat: { reasoning: { source: string; confidence: string; efforts: string[] } } };
    };

    expect(gpt55.capabilities.chat.reasoning.source).toBe("official-docs");
    expect(gpt55.capabilities.chat.reasoning.confidence).toBe("exact");
    expect(gpt55.capabilities.chat.reasoning.efforts).toContain("xhigh");
  });

  it("serves only Studio-curated registry metadata for models", async () => {
    const response = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      createEnv(),
      {} as ExecutionContext
    );
    const body = (await response.json()) as { source: string; registryVersion: string; data: Array<{ id: string }> };

    expect(body.source).toBe("studio-curated");
    expect(body.registryVersion).toBeDefined();
    expect(body.data.some((model) => model.id === "openai:gpt-5.5")).toBe(true);
  });

  it("persists registry model additions through MODEL_REGISTRY_KV and exposes them from /v1/models", async () => {
    const env = createEnv();
    const catalogResponse = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      env,
      {} as ExecutionContext
    );
    const catalog = (await catalogResponse.json()) as { data: Array<Record<string, unknown>> };
    const base = catalog.data.find((model) => model.id === "openai:gpt-5.6-sol") as Record<string, unknown>;
    const custom = {
      ...base,
      id: "openai:gpt-admin-test",
      providerModelId: "gpt-admin-test",
      displayName: "GPT Admin Test",
      registry: {
        ...(base.registry as Record<string, unknown>),
        aliases: ["gpt-admin-test"],
        version: "gpt-admin-test"
      }
    };

    const saveResponse = await worker.fetch(
      new Request("https://gateway.test/management/registry/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(custom)
      }),
      env,
      {} as ExecutionContext
    );
    const saveBody = (await saveResponse.json()) as { persisted: boolean };
    expect(saveResponse.status).toBe(200);
    expect(saveBody.persisted).toBe(true);

    const updatedResponse = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      env,
      {} as ExecutionContext
    );
    const updated = (await updatedResponse.json()) as { data: Array<{ id: string; displayName?: string }> };
    expect(updated.data.some((model) => model.id === "openai:gpt-admin-test" && model.displayName === "GPT Admin Test")).toBe(true);
  });

  it("requires the internal registry management token when configured", async () => {
    const env = { ...createEnv(), REGISTRY_MANAGEMENT_TOKEN: "registry-secret" };

    const denied = await worker.fetch(
      new Request("https://gateway.test/management/registry/export"),
      env,
      {} as ExecutionContext
    );
    expect(denied.status).toBe(403);

    const allowed = await worker.fetch(
      new Request("https://gateway.test/management/registry/export", {
        headers: { "x-studio-registry-management-token": "registry-secret" }
      }),
      env,
      {} as ExecutionContext
    );
    expect(allowed.status).toBe(200);
  });

  it("deletes persisted custom registry models", async () => {
    const env = createEnv();
    const catalogResponse = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      env,
      {} as ExecutionContext
    );
    const catalog = (await catalogResponse.json()) as { data: Array<Record<string, unknown>> };
    const base = catalog.data.find((model) => model.id === "openai:gpt-5.6-sol") as Record<string, unknown>;
    const custom = {
      ...base,
      id: "openai:gpt-delete-test",
      providerModelId: "gpt-delete-test",
      displayName: "GPT Delete Test",
      registry: {
        ...(base.registry as Record<string, unknown>),
        aliases: ["gpt-delete-test"],
        version: "gpt-delete-test"
      }
    };

    await worker.fetch(
      new Request("https://gateway.test/management/registry/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(custom)
      }),
      env,
      {} as ExecutionContext
    );

    const deleteResponse = await worker.fetch(
      new Request(`https://gateway.test/management/registry/models/${encodeURIComponent("openai:gpt-delete-test")}`, {
        method: "DELETE"
      }),
      env,
      {} as ExecutionContext
    );
    const deleteBody = (await deleteResponse.json()) as { deleted: boolean };
    expect(deleteResponse.status).toBe(200);
    expect(deleteBody.deleted).toBe(true);

    const updatedResponse = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      env,
      {} as ExecutionContext
    );
    const updated = (await updatedResponse.json()) as { data: Array<{ id: string }> };
    expect(updated.data.some((model) => model.id === "openai:gpt-delete-test")).toBe(false);
  });

  it("deletes built-in curated registry models from the active registry", async () => {
    const env = createEnv();

    const deleteResponse = await worker.fetch(
      new Request(`https://gateway.test/management/registry/models/${encodeURIComponent("openai:gpt-5.5")}`, {
        method: "DELETE"
      }),
      env,
      {} as ExecutionContext
    );
    expect(deleteResponse.status).toBe(200);

    const updatedResponse = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      env,
      {} as ExecutionContext
    );
    const updated = (await updatedResponse.json()) as { data: Array<{ id: string }> };
    expect(updated.data.some((model) => model.id === "openai:gpt-5.5")).toBe(false);
  });

  it("includes curated OpenRouter free routes with free metadata", async () => {
    const response = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      createEnv(),
      {} as ExecutionContext
    );
    const body = (await response.json()) as {
      data: Array<{ id: string; contextWindow?: number; maxTokens?: number; registry: { freeAccess?: { isFree?: boolean } } }>;
    };
    const freeIds = [
      "openrouter:openai/gpt-oss-20b:free",
      "openrouter:openai/gpt-oss-120b:free",
      "openrouter:poolside/laguna-xs-2.1:free",
      "openrouter:cohere/north-mini-code:free",
      "openrouter:nvidia/nemotron-3-super-120b-a12b:free",
      "openrouter:tencent/hy3:free",
      "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free",
      "openrouter:google/gemma-4-31b-it:free"
    ];

    for (const id of freeIds) {
      const model = body.data.find((candidate) => candidate.id === id);
      expect(model, id).toBeDefined();
      expect(model?.registry.freeAccess?.isFree).toBe(true);
    }

    expect(body.data.find((model) => model.id === "openrouter:google/gemma-4-31b-it:free")?.maxTokens).toBe(8192);
    expect(body.data.find((model) => model.id === "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free")?.contextWindow).toBe(1_000_000);
  });

  it("deletes OpenRouter models whose ids include slashes", async () => {
    const env = createEnv();
    const id = "openrouter:poolside/laguna-xs-2.1:free";
    const deleteResponse = await worker.fetch(
      new Request(`https://gateway.test/management/registry/models/${encodeURIComponent(id)}`, {
        method: "DELETE"
      }),
      env,
      {} as ExecutionContext
    );
    expect(deleteResponse.status).toBe(200);

    const updatedResponse = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      env,
      {} as ExecutionContext
    );
    const updated = (await updatedResponse.json()) as { data: Array<{ id: string }> };
    expect(updated.data.some((model) => model.id === id)).toBe(false);
  });

  it("routes chat requests through a persisted registry model", async () => {
    const env = createEnv();
    const catalogResponse = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      env,
      {} as ExecutionContext
    );
    const catalog = (await catalogResponse.json()) as { data: Array<Record<string, unknown>> };
    const base = catalog.data.find((model) => model.id === "openai:gpt-5.6-sol") as Record<string, unknown>;
    const custom = {
      ...base,
      id: "openai:gpt-admin-routing-test",
      providerModelId: "gpt-admin-routing-test",
      displayName: "GPT Admin Routing Test",
      registry: {
        ...(base.registry as Record<string, unknown>),
        aliases: ["gpt-admin-routing-test"],
        version: "gpt-admin-routing-test"
      }
    };

    await worker.fetch(
      new Request("https://gateway.test/management/registry/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(custom)
      }),
      env,
      {} as ExecutionContext
    );

    vi.mocked(generateText).mockResolvedValue({
      text: "custom model routed",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 2 },
      toolCalls: []
    } as never);

    const response = await postChat(env, {
      model: "openai:gpt-admin-routing-test",
      messages: [{ role: "user", content: "Say hello" }]
    });

    const body = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    expect(response.status).toBe(200);
    expect(body.choices[0].message.content).toBe("custom model routed");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("sends CF AI Gateway headers and strips provider Authorization", async () => {
    const seen = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("cf-aig-authorization")).toBe("Bearer cf-token");
      expect(headers.get("cf-aig-byok-alias")).toBe("production");
      expect(headers.has("authorization")).toBe(false);
      return Response.json({ ok: true });
    });

    const transport = getTransport("openai", createEnv(), seen as typeof fetch);
    await transport.fetch(`${transport.baseURL}/responses`, {
      headers: {
        ...transport.headers,
        Authorization: "Bearer provider-key-that-must-not-leave"
      }
    });

    expect(transport.baseURL).toBe(
      "https://gateway.ai.cloudflare.com/v1/account-123/studio-gateway/openai"
    );
    expect(seen).toHaveBeenCalledOnce();
  });

  it("handles OpenAI embeddings", async () => {
    vi.mocked(embed).mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      usage: { tokens: 3 }
    } as never);

    const response = await postJson(createEnv(), "/v1/embeddings", {
      model: "text-embedding-3-small",
      input: "hello"
    });

    const body = (await response.json()) as { data: Array<{ embedding: number[] }> };
    expect(response.status).toBe(200);
    expect(body.data[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(embed).toHaveBeenCalledOnce();
  });

  it("handles OpenAI speech-to-text transcription", async () => {
    vi.mocked(experimental_transcribe).mockResolvedValue({
      text: "hello audio",
      language: "en",
      durationInSeconds: 1,
      segments: []
    } as never);

    const form = new FormData();
    form.set("model", "gpt-4o-transcribe");
    form.set("file", new File([new Uint8Array([1, 2, 3])], "sample.wav", { type: "audio/wav" }));

    const response = await worker.fetch(
      new Request("https://gateway.test/v1/audio/transcriptions", {
        method: "POST",
        body: form
      }),
      createEnv(),
      {} as ExecutionContext
    );

    const body = (await response.json()) as { text: string };
    expect(response.status).toBe(200);
    expect(body.text).toBe("hello audio");
    expect(experimental_transcribe).toHaveBeenCalledOnce();
  });

  it("handles OpenAI text-to-speech", async () => {
    vi.mocked(experimental_generateSpeech).mockResolvedValue({
      audio: {
        uint8Array: new Uint8Array([1, 2, 3]),
        mediaType: "audio/mpeg"
      }
    } as never);

    const response = await postJson(createEnv(), "/v1/audio/speech", {
      model: "gpt-4o-mini-tts",
      input: "hello",
      voice: "alloy"
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("audio/mpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(experimental_generateSpeech).toHaveBeenCalledOnce();
  });

  it("handles OpenAI image generation", async () => {
    vi.mocked(generateImage).mockResolvedValue({
      images: [
        {
          base64: "aGVsbG8=",
          uint8Array: new Uint8Array([104, 101, 108, 108, 111]),
          mediaType: "image/png"
        }
      ],
      usage: {}
    } as never);

    const response = await postJson(createEnv(), "/v1/images/generations", {
      model: "gpt-image-2",
      prompt: "A tiny test image"
    });

    const body = (await response.json()) as { data: Array<{ b64_json: string }> };
    expect(response.status).toBe(200);
    expect(body.data[0].b64_json).toBe("aGVsbG8=");
    expect(generateImage).toHaveBeenCalledOnce();
  });

  // ── Anthropic (Claude) ────────────────────────────────────────────────────

  it("handles a non-streaming Anthropic chat completion", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hello from Claude",
      finishReason: "stop",
      usage: { inputTokens: 3, outputTokens: 4 },
      toolCalls: []
    } as never);

    const response = await postChat(createEnv(), {
      model: "claude-opus-4-8",
      messages: [{ role: "user", content: "Say hello" }]
    });

    const body = (await response.json()) as { provider: string; choices: Array<{ message: { content: string } }> };
    expect(response.status).toBe(200);
    expect(body.provider).toBe("anthropic");
    expect(body.choices[0].message.content).toBe("hello from Claude");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("streams Anthropic chat completions as SSE", async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Cla" };
        yield { type: "text-delta", text: "ude" };
      })()
    } as never);

    const response = await postChat(createEnv(), {
      model: "claude-sonnet-5",
      stream: true,
      messages: [{ role: "user", content: "Say hello" }]
    });

    const text = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("Cla");
    expect(text).toContain("[DONE]");
  });

  it("passes Anthropic tool calls through the chat response", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "",
      finishReason: "tool-calls",
      usage: {},
      toolCalls: [{ toolName: "lookup", input: { q: "weather" } }]
    } as never);

    const response = await postChat(createEnv(), {
      model: "claude-opus-4-8",
      messages: [{ role: "user", content: "Use a tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            parameters: { type: "object", properties: { q: { type: "string" } } }
          }
        }
      ]
    });

    const body = (await response.json()) as { choices: Array<{ message: { tool_calls: unknown[] } }> };
    expect(response.status).toBe(200);
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
  });

  it("accepts vision input for a vision-capable Claude model", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "that is an image",
      finishReason: "stop",
      usage: {},
      toolCalls: []
    } as never);

    const response = await postChat(createEnv(), {
      model: "claude-opus-4-8",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" }
          ]
        }
      ]
    });

    expect(response.status).toBe(200);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("rejects embeddings on Anthropic before calling the provider", async () => {
    vi.mocked(embed).mockResolvedValue({ embedding: [0.1], usage: {} } as never);

    const response = await postJson(createEnv(), "/v1/embeddings", {
      model: "claude-opus-4-8",
      input: "hello"
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(embed).not.toHaveBeenCalled();
  });

  it("marks exact reviewed reasoning metadata for a curated Claude model", async () => {
    const response = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      createEnv(),
      {} as ExecutionContext
    );
    const body = (await response.json()) as { data: Array<{ id: string; capabilities: { chat?: unknown } }> };
    const opus = body.data.find((model) => model.id === "anthropic:claude-opus-4-8") as {
      capabilities: { chat: { reasoning: { source: string; confidence: string; efforts: string[] } } };
    };

    expect(opus.capabilities.chat.reasoning.source).toBe("official-docs");
    expect(opus.capabilities.chat.reasoning.confidence).toBe("exact");
    expect(opus.capabilities.chat.reasoning.efforts).toContain("xhigh");
  });

  it("maps effort to adaptive thinking + effort for modern Claude (Opus 4.8), not budget_tokens", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "ok", finishReason: "stop", usage: {}, toolCalls: [] } as never);

    await postChat(createEnv(), {
      model: "claude-opus-4-8",
      reasoningEffort: "high",
      messages: [{ role: "user", content: "Think" }]
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      providerOptions: { anthropic: { effort?: string; thinking?: { type: string; budgetTokens?: number } } };
    };
    expect(call.providerOptions.anthropic.effort).toBe("high");
    expect(call.providerOptions.anthropic.thinking).toEqual({ type: "adaptive" });
    expect(call.providerOptions.anthropic.thinking?.budgetTokens).toBeUndefined();
  });

  it("maps xhigh effort straight through for modern Claude (Opus 4.8)", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "ok", finishReason: "stop", usage: {}, toolCalls: [] } as never);

    await postChat(createEnv(), {
      model: "claude-opus-4-8",
      reasoningEffort: "xhigh",
      messages: [{ role: "user", content: "Think hard" }]
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      providerOptions: { anthropic: { effort?: string } };
    };
    expect(call.providerOptions.anthropic.effort).toBe("xhigh");
  });

  it("uses manual budget_tokens thinking for legacy Claude (Haiku 4.5), not effort", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "ok", finishReason: "stop", usage: {}, toolCalls: [] } as never);

    await postChat(createEnv(), {
      model: "claude-haiku-4-5",
      reasoningEffort: "high",
      messages: [{ role: "user", content: "Think" }]
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      providerOptions: { anthropic: { effort?: string; thinking?: { type: string; budgetTokens?: number } } };
    };
    expect(call.providerOptions.anthropic.thinking).toEqual({ type: "enabled", budgetTokens: 16000 });
    expect(call.providerOptions.anthropic.effort).toBeUndefined();
  });

  it("omits Anthropic thinking/effort when reasoning effort is 'none'", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "ok", finishReason: "stop", usage: {}, toolCalls: [] } as never);

    await postChat(createEnv(), {
      model: "claude-opus-4-8",
      reasoningEffort: "none",
      messages: [{ role: "user", content: "Answer directly" }]
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      providerOptions: { anthropic: { effort?: string; thinking?: unknown } };
    };
    expect(call.providerOptions.anthropic.effort).toBeUndefined();
    expect(call.providerOptions.anthropic.thinking).toBeUndefined();
  });

  it("routes Anthropic through CF AI Gateway and strips the provider x-api-key header", async () => {
    const seen = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("cf-aig-authorization")).toBe("Bearer cf-token");
      expect(headers.get("cf-aig-byok-alias")).toBe("production");
      expect(headers.has("x-api-key")).toBe(false);
      return Response.json({ ok: true });
    });

    const transport = getTransport("anthropic", createEnv(), seen as typeof fetch);
    await transport.fetch(`${transport.baseURL}/messages`, {
      headers: {
        ...transport.headers,
        "x-api-key": "provider-key-that-must-not-leave",
        "anthropic-version": "2023-06-01"
      }
    });

    expect(transport.baseURL).toBe("https://gateway.ai.cloudflare.com/v1/account-123/studio-gateway/anthropic/v1");
    expect(seen).toHaveBeenCalledOnce();
  });

  // ── Groq (OpenAI-wire-compatible) ─────────────────────────────────────────

  it("handles a non-streaming Groq chat completion", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hello from Groq",
      finishReason: "stop",
      usage: { inputTokens: 3, outputTokens: 4 },
      toolCalls: []
    } as never);

    const response = await postChat(createEnv(), {
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: "Say hello" }]
    });

    const body = (await response.json()) as { provider: string; choices: Array<{ message: { content: string } }> };
    expect(response.status).toBe(200);
    expect(body.provider).toBe("groq");
    expect(body.choices[0].message.content).toBe("hello from Groq");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("streams Groq chat completions as SSE", async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Gr" };
        yield { type: "text-delta", text: "oq" };
      })()
    } as never);

    const response = await postChat(createEnv(), {
      model: "openai/gpt-oss-20b",
      stream: true,
      messages: [{ role: "user", content: "Say hello" }]
    });

    const text = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("Gr");
    expect(text).toContain("[DONE]");
  });

  it("passes Groq tool calls through the chat response", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "",
      finishReason: "tool-calls",
      usage: {},
      toolCalls: [{ toolName: "lookup", input: { q: "weather" } }]
    } as never);

    const response = await postChat(createEnv(), {
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: "Use a tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            parameters: { type: "object", properties: { q: { type: "string" } } }
          }
        }
      ]
    });

    const body = (await response.json()) as { choices: Array<{ message: { tool_calls: unknown[] } }> };
    expect(response.status).toBe(200);
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
  });

  it("disables parallel tool calls for gpt-oss-120b via provider options", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "",
      finishReason: "tool-calls",
      usage: {},
      toolCalls: [{ toolName: "lookup", input: {} }]
    } as never);

    await postChat(createEnv(), {
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: "Use a tool" }],
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }]
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      providerOptions: { groq: { parallelToolCalls?: boolean } };
    };
    expect(call.providerOptions.groq.parallelToolCalls).toBe(false);
  });

  it("does not disable parallel tool calls for gpt-oss-20b", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "ok", finishReason: "stop", usage: {}, toolCalls: [] } as never);

    await postChat(createEnv(), {
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: "hi" }]
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      providerOptions: { groq: { parallelToolCalls?: boolean } };
    };
    expect(call.providerOptions.groq.parallelToolCalls).toBeUndefined();
  });

  it("accepts vision input for a vision-capable Groq Qwen model", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "that is an image",
      finishReason: "stop",
      usage: {},
      toolCalls: []
    } as never);

    const response = await postChat(createEnv(), {
      model: "qwen/qwen3.6-27b",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" }
          ]
        }
      ]
    });

    expect(response.status).toBe(200);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("rejects vision input for a text-only Groq model before calling the provider", async () => {
    const response = await postChat(createEnv(), {
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" }
          ]
        }
      ]
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("maps gpt-oss reasoning effort straight through to Groq", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "ok", finishReason: "stop", usage: {}, toolCalls: [] } as never);

    await postChat(createEnv(), {
      model: "openai/gpt-oss-120b",
      reasoningEffort: "high",
      messages: [{ role: "user", content: "Think" }]
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      providerOptions: { groq: { reasoningEffort?: string } };
    };
    expect(call.providerOptions.groq.reasoningEffort).toBe("high");
  });

  it("collapses qwen reasoning effort to Groq's on/off default", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "ok", finishReason: "stop", usage: {}, toolCalls: [] } as never);

    await postChat(createEnv(), {
      model: "qwen/qwen3-32b",
      reasoningEffort: "high",
      messages: [{ role: "user", content: "Think" }]
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      providerOptions: { groq: { reasoningEffort?: string } };
    };
    expect(call.providerOptions.groq.reasoningEffort).toBe("default");
  });

  it("handles Groq Whisper speech-to-text transcription", async () => {
    vi.mocked(experimental_transcribe).mockResolvedValue({
      text: "hello groq audio",
      language: "en",
      durationInSeconds: 1,
      segments: []
    } as never);

    const form = new FormData();
    form.set("model", "whisper-large-v3");
    form.set("file", new File([new Uint8Array([1, 2, 3])], "sample.wav", { type: "audio/wav" }));

    const response = await worker.fetch(
      new Request("https://gateway.test/v1/audio/transcriptions", { method: "POST", body: form }),
      createEnv(),
      {} as ExecutionContext
    );

    const body = (await response.json()) as { text: string };
    expect(response.status).toBe(200);
    expect(body.text).toBe("hello groq audio");
    expect(experimental_transcribe).toHaveBeenCalledOnce();
  });

  it("rejects tools requested on a Groq Whisper (STT) model", async () => {
    const response = await postChat(createEnv(), {
      model: "whisper-large-v3",
      messages: [{ role: "user", content: "transcribe" }],
      tools: [{ type: "function", function: { name: "noop", parameters: { type: "object", properties: {} } } }]
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("rejects embeddings on Groq before calling the provider", async () => {
    vi.mocked(embed).mockResolvedValue({ embedding: [0.1], usage: {} } as never);

    const response = await postJson(createEnv(), "/v1/embeddings", {
      model: "openai/gpt-oss-20b",
      input: "hello"
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(embed).not.toHaveBeenCalled();
  });

  it("excludes Groq safety/guard models from the curated catalog", async () => {
    const response = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      createEnv(),
      {} as ExecutionContext
    );
    const body = (await response.json()) as { data: Array<{ id: string; provider: string }> };
    const ids = body.data.filter((model) => model.provider === "groq").map((model) => model.id);

    expect(ids).toContain("groq:openai/gpt-oss-20b");
    expect(ids.some((id) => /guard/.test(id))).toBe(false);
  });

  it("marks exact reviewed reasoning metadata for a curated Groq (gpt-oss) model", async () => {
    const response = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      createEnv(),
      {} as ExecutionContext
    );
    const body = (await response.json()) as { data: Array<{ id: string; capabilities: { chat?: unknown } }> };
    const gptOss = body.data.find((model) => model.id === "groq:openai/gpt-oss-120b") as {
      capabilities: { chat: { reasoning: { source: string; confidence: string; efforts: string[] } } };
    };

    expect(gptOss.capabilities.chat.reasoning.source).toBe("official-docs");
    expect(gptOss.capabilities.chat.reasoning.confidence).toBe("exact");
    expect(gptOss.capabilities.chat.reasoning.efforts).toEqual(["low", "medium", "high"]);
  });


  it("routes Groq through CF AI Gateway and strips the provider Authorization header", async () => {
    const seen = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("cf-aig-authorization")).toBe("Bearer cf-token");
      expect(headers.get("cf-aig-byok-alias")).toBe("production");
      expect(headers.has("authorization")).toBe(false);
      return Response.json({ ok: true });
    });

    const transport = getTransport("groq", createEnv(), seen as typeof fetch);
    await transport.fetch(`${transport.baseURL}/chat/completions`, {
      headers: {
        ...transport.headers,
        Authorization: "Bearer provider-key-that-must-not-leave"
      }
    });

    expect(transport.baseURL).toBe("https://gateway.ai.cloudflare.com/v1/account-123/studio-gateway/groq");
    expect(seen).toHaveBeenCalledOnce();
  });

  // ── xAI (Grok, OpenAI-wire-compatible) ─────────────────────────────────────

  it("handles a non-streaming xAI chat completion", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hello from Grok",
      finishReason: "stop",
      usage: { inputTokens: 3, outputTokens: 4 },
      toolCalls: []
    } as never);

    const response = await postChat(createEnv(), {
      model: "grok-4.3",
      messages: [{ role: "user", content: "Say hello" }]
    });

    const body = (await response.json()) as { provider: string; choices: Array<{ message: { content: string } }> };
    expect(response.status).toBe(200);
    expect(body.provider).toBe("xai");
    expect(body.choices[0].message.content).toBe("hello from Grok");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("streams xAI chat completions as SSE", async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Gr" };
        yield { type: "text-delta", text: "ok" };
      })()
    } as never);

    const response = await postChat(createEnv(), {
      model: "grok-4.5",
      stream: true,
      messages: [{ role: "user", content: "Say hello" }]
    });

    const text = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("Gr");
    expect(text).toContain("[DONE]");
  });

  it("passes xAI tool calls through the chat response", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "",
      finishReason: "tool-calls",
      usage: {},
      toolCalls: [{ toolName: "lookup", input: { q: "weather" } }]
    } as never);

    const response = await postChat(createEnv(), {
      model: "grok-4.3",
      messages: [{ role: "user", content: "Use a tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            parameters: { type: "object", properties: { q: { type: "string" } } }
          }
        }
      ]
    });

    const body = (await response.json()) as { choices: Array<{ message: { tool_calls: unknown[] } }> };
    expect(response.status).toBe(200);
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
  });

  it("accepts vision input for a vision-capable Grok model (grok-4.3)", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "that is an image",
      finishReason: "stop",
      usage: {},
      toolCalls: []
    } as never);

    const response = await postChat(createEnv(), {
      model: "grok-4.3",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" }
          ]
        }
      ]
    });

    expect(response.status).toBe(200);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("marks exact reviewed reasoning metadata for a curated Grok model (grok-4.3)", async () => {
    const response = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      createEnv(),
      {} as ExecutionContext
    );
    const body = (await response.json()) as { data: Array<{ id: string; capabilities: { chat?: unknown } }> };
    const grok43 = body.data.find((model) => model.id === "xai:grok-4.3") as {
      capabilities: { chat: { reasoning: { source: string; confidence: string; efforts: string[] } } };
    };

    expect(grok43.capabilities.chat.reasoning.source).toBe("official-docs");
    expect(grok43.capabilities.chat.reasoning.confidence).toBe("exact");
    expect(grok43.capabilities.chat.reasoning.efforts).toEqual(["none", "low", "medium", "high"]);
  });


  it("maps xAI reasoning effort straight through to providerOptions.xai.reasoningEffort", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "ok", finishReason: "stop", usage: {}, toolCalls: [] } as never);

    await postChat(createEnv(), {
      model: "grok-4.3",
      reasoningEffort: "high",
      messages: [{ role: "user", content: "Think" }]
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      providerOptions: { xai: { reasoningEffort?: string } };
    };
    expect(call.providerOptions.xai.reasoningEffort).toBe("high");
  });

  it("rejects xhigh reasoning effort on xAI before calling the provider", async () => {
    const response = await postChat(createEnv(), {
      model: "grok-4.3",
      reasoningEffort: "xhigh",
      messages: [{ role: "user", content: "Think" }]
    });

    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(body.error.message).toContain("xhigh");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("routes xAI through CF AI Gateway and strips the provider Authorization header", async () => {
    const seen = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("cf-aig-authorization")).toBe("Bearer cf-token");
      expect(headers.get("cf-aig-byok-alias")).toBe("production");
      expect(headers.has("authorization")).toBe(false);
      return Response.json({ ok: true });
    });

    const transport = getTransport("xai", createEnv(), seen as typeof fetch);
    await transport.fetch(`${transport.baseURL}/chat/completions`, {
      headers: {
        ...transport.headers,
        Authorization: "Bearer provider-key-that-must-not-leave"
      }
    });

    expect(transport.baseURL).toBe("https://gateway.ai.cloudflare.com/v1/account-123/studio-gateway/grok");
    expect(seen).toHaveBeenCalledOnce();
  });

  it("rejects embeddings on xAI before calling the provider", async () => {
    vi.mocked(embed).mockResolvedValue({ embedding: [0.1], usage: {} } as never);

    const response = await postJson(createEnv(), "/v1/embeddings", {
      model: "grok-4.3",
      input: "hello"
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(embed).not.toHaveBeenCalled();
  });

  // ── DeepSeek (OpenAI-wire-compatible) ──────────────────────────────────────

  it("handles a non-streaming DeepSeek chat completion", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hello from DeepSeek",
      finishReason: "stop",
      usage: { inputTokens: 3, outputTokens: 4 },
      toolCalls: []
    } as never);

    const response = await postChat(createEnv(), {
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "Say hello" }]
    });

    const body = (await response.json()) as { provider: string; choices: Array<{ message: { content: string } }> };
    expect(response.status).toBe(200);
    expect(body.provider).toBe("deepseek");
    expect(body.choices[0].message.content).toBe("hello from DeepSeek");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("streams DeepSeek chat completions as SSE (content + reasoning)", async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: (async function* () {
        yield { type: "reasoning-delta", text: "thinking" };
        yield { type: "text-delta", text: "Deep" };
        yield { type: "text-delta", text: "Seek" };
      })()
    } as never);

    const response = await postChat(createEnv(), {
      model: "deepseek-v4-flash",
      stream: true,
      messages: [{ role: "user", content: "Say hello" }]
    });

    const text = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("reasoning");
    expect(text).toContain("Deep");
    expect(text).toContain("[DONE]");
  });

  it("passes DeepSeek tool calls through the chat response", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "",
      finishReason: "tool-calls",
      usage: {},
      toolCalls: [{ toolName: "lookup", input: { q: "weather" } }]
    } as never);

    const response = await postChat(createEnv(), {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "Use a tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            parameters: { type: "object", properties: { q: { type: "string" } } }
          }
        }
      ]
    });

    const body = (await response.json()) as { choices: Array<{ message: { tool_calls: unknown[] } }> };
    expect(response.status).toBe(200);
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
  });

  it("maps DeepSeek reasoning effort to providerOptions.deepseek (thinking + reasoningEffort)", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "ok", finishReason: "stop", usage: {}, toolCalls: [] } as never);

    await postChat(createEnv(), {
      model: "deepseek-v4-flash",
      reasoningEffort: "high",
      messages: [{ role: "user", content: "Think" }]
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      providerOptions: { deepseek: { thinking?: { type: string }; reasoningEffort?: string } };
    };
    expect(call.providerOptions.deepseek.thinking).toEqual({ type: "enabled" });
    expect(call.providerOptions.deepseek.reasoningEffort).toBe("high");
  });

  it("disables DeepSeek thinking when reasoning effort is 'none'", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "ok", finishReason: "stop", usage: {}, toolCalls: [] } as never);

    await postChat(createEnv(), {
      model: "deepseek-v4-flash",
      reasoningEffort: "none",
      messages: [{ role: "user", content: "Answer directly" }]
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      providerOptions: { deepseek: { thinking?: { type: string }; reasoningEffort?: string } };
    };
    expect(call.providerOptions.deepseek.thinking).toEqual({ type: "disabled" });
    expect(call.providerOptions.deepseek.reasoningEffort).toBeUndefined();
  });

  it("rejects vision input for a text-only DeepSeek model before calling the provider", async () => {
    const response = await postChat(createEnv(), {
      model: "deepseek-v4-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" }
          ]
        }
      ]
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("rejects embeddings on DeepSeek before calling the provider", async () => {
    vi.mocked(embed).mockResolvedValue({ embedding: [0.1], usage: {} } as never);

    const response = await postJson(createEnv(), "/v1/embeddings", {
      model: "deepseek-v4-flash",
      input: "hello"
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(embed).not.toHaveBeenCalled();
  });

  it("marks exact reviewed reasoning metadata for a curated DeepSeek model (deepseek-v4-flash)", async () => {
    const response = await worker.fetch(
      new Request("https://gateway.test/v1/models"),
      createEnv(),
      {} as ExecutionContext
    );
    const body = (await response.json()) as { data: Array<{ id: string; capabilities: { chat?: unknown } }> };
    const flash = body.data.find((model) => model.id === "deepseek:deepseek-v4-flash") as {
      capabilities: { chat: { reasoning: { source: string; confidence: string; efforts: string[] } } };
    };

    expect(flash.capabilities.chat.reasoning.source).toBe("official-docs");
    expect(flash.capabilities.chat.reasoning.confidence).toBe("exact");
    expect(flash.capabilities.chat.reasoning.efforts).toEqual(["none", "low", "medium", "high", "xhigh"]);
  });


  it("routes DeepSeek through CF AI Gateway and strips the provider Authorization header", async () => {
    const seen = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("cf-aig-authorization")).toBe("Bearer cf-token");
      expect(headers.get("cf-aig-byok-alias")).toBe("production");
      expect(headers.has("authorization")).toBe(false);
      return Response.json({ ok: true });
    });

    const transport = getTransport("deepseek", createEnv(), seen as typeof fetch);
    await transport.fetch(`${transport.baseURL}/chat/completions`, {
      headers: {
        ...transport.headers,
        Authorization: "Bearer provider-key-that-must-not-leave"
      }
    });

    expect(transport.baseURL).toBe("https://gateway.ai.cloudflare.com/v1/account-123/studio-gateway/deepseek");
    expect(seen).toHaveBeenCalledOnce();
  });

  // ── Structured output (response_format: json_schema) ──────────────────────
  // The schema is passed to the model via the AI SDK's experimental_output across every
  // provider that declares the json-schema sub-feature (openai/google/groq). Anthropic
  // deliberately declares it unsupported (structured output via tool use) and is rejected.

  const PERSON_JSON_SCHEMA = {
    type: "json_schema" as const,
    json_schema: {
      name: "person",
      schema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false
      }
    }
  };

  it("passes the JSON schema to OpenAI via structured output", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '{"name":"Ada"}',
      finishReason: "stop",
      usage: {},
      toolCalls: []
    } as never);

    await postChat(createEnv(), {
      model: "gpt-5.6-sol",
      messages: [{ role: "user", content: "Give me a person" }],
      responseFormat: PERSON_JSON_SCHEMA
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as { experimental_output?: unknown };
    expect(call.experimental_output).toBeDefined();
  });

  it("passes the JSON schema to Google via structured output", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '{"name":"Ada"}',
      finishReason: "stop",
      usage: {},
      toolCalls: []
    } as never);

    await postChat(createEnv(), {
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "Give me a person" }],
      responseFormat: PERSON_JSON_SCHEMA
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as { experimental_output?: unknown };
    expect(call.experimental_output).toBeDefined();
  });

  it("passes the JSON schema to Groq via structured output", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '{"name":"Ada"}',
      finishReason: "stop",
      usage: {},
      toolCalls: []
    } as never);

    await postChat(createEnv(), {
      // Groq supports json_schema on the curated gpt-oss routes.
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: "Give me a person" }],
      responseFormat: PERSON_JSON_SCHEMA
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as { experimental_output?: unknown };
    expect(call.experimental_output).toBeDefined();
  });

  it("passes the JSON schema to DeepSeek via structured output", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '{"name":"Ada"}',
      finishReason: "stop",
      usage: {},
      toolCalls: []
    } as never);

    await postChat(createEnv(), {
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "Give me a person" }],
      responseFormat: PERSON_JSON_SCHEMA
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as { experimental_output?: unknown };
    expect(call.experimental_output).toBeDefined();
  });

  it("rejects json_schema on a Groq model that only supports json_object", async () => {
    const response = await postChat(createEnv(), {
      model: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "Give me a person" }],
      responseFormat: PERSON_JSON_SCHEMA
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("leaves structured output unset for a plain chat request", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hi",
      finishReason: "stop",
      usage: {},
      toolCalls: []
    } as never);

    await postChat(createEnv(), {
      model: "gpt-5.6-sol",
      messages: [{ role: "user", content: "hi" }]
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as { experimental_output?: unknown };
    expect(call.experimental_output).toBeUndefined();
  });

  it("rejects json_schema on Anthropic (structured output via tool use is unsupported)", async () => {
    const response = await postChat(createEnv(), {
      model: "claude-opus-4-8",
      messages: [{ role: "user", content: "Give me a person" }],
      responseFormat: PERSON_JSON_SCHEMA
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(generateText).not.toHaveBeenCalled();
  });

  // ── Mistral (OpenAI-wire-compatible: curated chat) ─────────────────────────

  it("handles a non-streaming Mistral chat completion", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hello from Mistral",
      finishReason: "stop",
      usage: { inputTokens: 3, outputTokens: 4 },
      toolCalls: []
    } as never);

    const response = await postChat(createEnv(), {
      model: "mistral-medium-3.5",
      messages: [{ role: "user", content: "Say hello" }]
    });

    const body = (await response.json()) as { provider: string; choices: Array<{ message: { content: string } }> };
    expect(response.status).toBe(200);
    expect(body.provider).toBe("mistral");
    expect(body.choices[0].message.content).toBe("hello from Mistral");
  });

  it("streams Mistral chat completions as SSE", async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Mis" };
        yield { type: "text-delta", text: "tral" };
      })()
    } as never);

    const response = await postChat(createEnv(), {
      model: "mistral-medium-3.5",
      stream: true,
      messages: [{ role: "user", content: "Say hello" }]
    });

    const text = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("Mis");
    expect(text).toContain("[DONE]");
  });

  it("rejects reasoning effort on the curated non-reasoning Mistral model", async () => {
    const response = await postChat(createEnv(), {
      model: "mistral-medium-3.5",
      reasoningEffort: "medium",
      messages: [{ role: "user", content: "Think" }]
    });

    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("accepts vision input for the curated Mistral model", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "an image", finishReason: "stop", usage: {}, toolCalls: [] } as never);

    const visionMessage = [
      { type: "text" as const, text: "What is this?" },
      { type: "image" as const, image: "data:image/png;base64,abc", mediaType: "image/png" }
    ];

    const response = await postChat(createEnv(), {
      model: "mistral-medium-3.5",
      messages: [{ role: "user", content: visionMessage }]
    });
    expect(response.status).toBe(200);
  });

  it("rejects embeddings on Mistral before calling the provider", async () => {
    vi.mocked(embed).mockResolvedValue({ embedding: [0.4, 0.5], usage: { tokens: 2 } } as never);

    const response = await postJson(createEnv(), "/v1/embeddings", {
      model: "mistral-medium-3.5",
      input: "hello"
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(embed).not.toHaveBeenCalled();
  });


  it("routes Mistral through CF AI Gateway (with the /v1 base path) and strips Authorization", async () => {
    const seen = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("cf-aig-authorization")).toBe("Bearer cf-token");
      expect(headers.has("authorization")).toBe(false);
      return Response.json({ ok: true });
    });

    const transport = getTransport("mistral", createEnv(), seen as typeof fetch);
    await transport.fetch(`${transport.baseURL}/chat/completions`, {
      headers: { ...transport.headers, Authorization: "Bearer provider-key-that-must-not-leave" }
    });

    expect(transport.baseURL).toBe("https://gateway.ai.cloudflare.com/v1/account-123/studio-gateway/mistral/v1");
    expect(seen).toHaveBeenCalledOnce();
  });

  // ── Fal (media: image gen/edit, video, TTS, STT) ───────────────────────────

  it("handles Fal image generation", async () => {
    vi.mocked(generateImage).mockResolvedValue({
      images: [{ base64: "aW1n", uint8Array: new Uint8Array([1, 2, 3]), mediaType: "image/png" }],
      usage: {}
    } as never);

    const response = await postJson(createEnv(), "/v1/images/generations", {
      model: "fal-ai/bytedance/seedream/v5/lite/text-to-image",
      prompt: "a cat"
    });

    const body = (await response.json()) as { data: Array<{ b64_json: string }> };
    expect(response.status).toBe(200);
    expect(body.data[0].b64_json).toBe("aW1n");
    expect(generateImage).toHaveBeenCalledOnce();
  });

  it("handles Fal image editing (image-to-image) and forwards the source image", async () => {
    vi.mocked(generateImage).mockResolvedValue({
      images: [{ base64: "ZWRpdA==", uint8Array: new Uint8Array([4]), mediaType: "image/png" }],
      usage: {}
    } as never);

    const response = await postJson(createEnv(), "/v1/images/edits", {
      model: "fal-ai/flux-pro/kontext",
      prompt: "make it night",
      images: ["aGVsbG8="]
    });

    expect(response.status).toBe(200);
    const call = vi.mocked(generateImage).mock.calls[0][0] as unknown as { prompt: { images?: unknown[] } };
    expect(Array.isArray(call.prompt.images)).toBe(true);
  });

  it("rejects image editing on a text-to-image-only Fal model", async () => {
    const response = await postJson(createEnv(), "/v1/images/edits", {
      model: "fal-ai/bytedance/seedream/v5/lite/text-to-image",
      prompt: "make it night",
      images: ["aGVsbG8="]
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("handles Fal video generation (pass-through bytes)", async () => {
    vi.mocked(experimental_generateVideo).mockResolvedValue({
      video: { base64: "dmlk", uint8Array: new Uint8Array([9]), mediaType: "video/mp4" },
      videos: [{ base64: "dmlk", uint8Array: new Uint8Array([9]), mediaType: "video/mp4" }],
      providerMetadata: {}
    } as never);

    const response = await postJson(createEnv(), "/v1/videos/generations", {
      model: "fal-ai/veo3.1",
      prompt: "a rocket launch"
    });

    const body = (await response.json()) as { data: Array<{ b64_json: string; media_type: string }> };
    expect(response.status).toBe(200);
    expect(body.data[0].b64_json).toBe("dmlk");
    expect(body.data[0].media_type).toBe("video/mp4");
    expect(experimental_generateVideo).toHaveBeenCalledOnce();
  });

  it("passes an image input through to Fal for image-to-video", async () => {
    vi.mocked(experimental_generateVideo).mockResolvedValue({
      video: { base64: "dmlk", uint8Array: new Uint8Array([9]), mediaType: "video/mp4" },
      videos: [{ base64: "dmlk", uint8Array: new Uint8Array([9]), mediaType: "video/mp4" }],
      providerMetadata: {}
    } as never);

    await postJson(createEnv(), "/v1/videos/generations", {
      model: "bytedance/seedance-2.0/image-to-video",
      prompt: "animate this",
      image: "data:image/png;base64,aGVsbG8="
    });

    const call = vi.mocked(experimental_generateVideo).mock.calls[0][0] as unknown as { prompt: { image?: unknown } };
    expect(call.prompt.image).toBeDefined();
  });

  // ── Replicate (media: image gen/edit, video) ───────────────────────────────

  it("handles Replicate image generation", async () => {
    vi.mocked(generateImage).mockResolvedValue({
      images: [{ base64: "cmVw", uint8Array: new Uint8Array([1]), mediaType: "image/png" }],
      usage: {}
    } as never);

    const response = await postJson(createEnv(), "/v1/images/generations", {
      model: "bytedance/seedream-4.5",
      prompt: "a dog"
    });

    const body = (await response.json()) as { data: Array<{ b64_json: string }> };
    expect(response.status).toBe(200);
    expect(body.data[0].b64_json).toBe("cmVw");
  });

  it("handles Replicate image editing on a fill model", async () => {
    vi.mocked(generateImage).mockResolvedValue({
      images: [{ base64: "ZmlsbA==", uint8Array: new Uint8Array([2]), mediaType: "image/png" }],
      usage: {}
    } as never);

    const response = await postJson(createEnv(), "/v1/images/edits", {
      model: "black-forest-labs/flux-2-flex",
      prompt: "fill the gap",
      images: ["aGVsbG8="]
    });

    expect(response.status).toBe(200);
    expect(generateImage).toHaveBeenCalledOnce();
  });

  it("handles Replicate video generation", async () => {
    vi.mocked(experimental_generateVideo).mockResolvedValue({
      video: { base64: "cnZpZA==", uint8Array: new Uint8Array([3]), mediaType: "video/mp4" },
      videos: [{ base64: "cnZpZA==", uint8Array: new Uint8Array([3]), mediaType: "video/mp4" }],
      providerMetadata: {}
    } as never);

    const response = await postJson(createEnv(), "/v1/videos/generations", {
      model: "google/veo-3.1-lite",
      prompt: "ocean waves"
    });

    const body = (await response.json()) as { data: Array<{ b64_json: string }> };
    expect(response.status).toBe(200);
    expect(body.data[0].b64_json).toBe("cnZpZA==");
  });

  // ── ElevenLabs (audio: TTS + STT) ──────────────────────────────────────────

  it("handles ElevenLabs text-to-speech", async () => {
    vi.mocked(experimental_generateSpeech).mockResolvedValue({
      audio: { uint8Array: new Uint8Array([7, 8, 9]), mediaType: "audio/mpeg" }
    } as never);

    const response = await postJson(createEnv(), "/v1/audio/speech", {
      model: "eleven_v3",
      input: "hello there",
      voice: "21m00Tcm4TlvDq8ikWAM"
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("audio/mpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
  });

  it("handles ElevenLabs speech-to-text transcription", async () => {
    vi.mocked(experimental_transcribe).mockResolvedValue({
      text: "scribe output",
      language: "en",
      durationInSeconds: 2,
      segments: []
    } as never);

    const form = new FormData();
    form.set("model", "scribe_v2");
    form.set("file", new File([new Uint8Array([1, 2, 3])], "s.wav", { type: "audio/wav" }));

    const response = await worker.fetch(
      new Request("https://gateway.test/v1/audio/transcriptions", { method: "POST", body: form }),
      createEnv(),
      {} as ExecutionContext
    );

    const body = (await response.json()) as { text: string };
    expect(response.status).toBe(200);
    expect(body.text).toBe("scribe output");
  });

  it("routes ElevenLabs through CF AI Gateway and strips the provider xi-api-key header", async () => {
    const seen = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("cf-aig-authorization")).toBe("Bearer cf-token");
      expect(headers.get("cf-aig-byok-alias")).toBe("production");
      // ElevenLabs authenticates with xi-api-key; under BYOK it must never leave the worker.
      expect(headers.has("xi-api-key")).toBe(false);
      return new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } });
    });

    const transport = getTransport("elevenlabs", createEnv(), seen as typeof fetch);
    await transport.fetch(`${transport.baseURL}/v1/text-to-speech/voice`, {
      headers: { ...transport.headers, "xi-api-key": "provider-key-that-must-not-leave" }
    });

    expect(transport.baseURL).toBe("https://gateway.ai.cloudflare.com/v1/account-123/studio-gateway/elevenlabs");
    expect(seen).toHaveBeenCalledOnce();
  });
});
