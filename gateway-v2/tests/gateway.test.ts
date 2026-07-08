import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { getTransport } from "../src/core/transport";
import { listOpenAIModels } from "../src/llm/providers/openai/models";
import { listAnthropicModels } from "../src/llm/providers/anthropic/models";
import { listGroqModels } from "../src/llm/providers/groq/models";
import { listXaiModels } from "../src/llm/providers/xai/models";
import { listDeepSeekModels } from "../src/llm/providers/deepseek/models";
import { listMistralModels } from "../src/llm/providers/mistral/models";
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
    MODELS_KV: createKv(),
    CREDITS_KV: createKv(),
    ADMIN_KV: createKv()
  };
}

function mockModelsFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: [
          { id: "gpt-5", created: 1 },
          { id: "gpt-5.5", created: 2 },
          { id: "gpt-4o", created: 2 },
          { id: "gpt-4o-mini-search-preview", created: 3 },
          { id: "gpt-3.5-turbo", created: 4 }
        ]
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
    expect(body.data.some((model: { id: string }) => model.id === "openai:gpt-5")).toBe(true);
  });

  it("handles a non-streaming chat completion", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hello from OpenAI",
      finishReason: "stop",
      usage: { inputTokens: 4, outputTokens: 5 },
      toolCalls: []
    } as never);

    const response = await postChat(createEnv(), {
      model: "gpt-5",
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
      model: "gpt-5",
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
      model: "gpt-5",
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
      model: "gpt-4o",
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
      model: "gpt-3.5-turbo",
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
      model: "gpt-5.4-mini",
      reasoningEffort: "xhigh",
      messages: [{ role: "user", content: "Think carefully" }]
    });

    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(body.error.message).toContain("xhigh");
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

  it("uses a family-rule reasoning fallback for newer GPT-5.x models", async () => {
    const discovered = await listOpenAIModels({
      env: createEnv(),
      fetch: vi.fn(async () =>
        Response.json({
          data: [{ id: "gpt-5.6", created: 10 }]
        })
      ) as typeof fetch
    });
    const gpt56 = discovered.find((model) => model.id === "openai:gpt-5.6") as {
      capabilities: { chat: { reasoning: { source: string; confidence: string; efforts: string[] } } };
    };

    expect(gpt56).toBeDefined();
    expect(gpt56.capabilities.chat.reasoning.source).toBe("family-rule");
    expect(gpt56.capabilities.chat.reasoning.confidence).toBe("family");
    expect(gpt56.capabilities.chat.reasoning.efforts).toEqual(["none", "low", "medium", "high", "xhigh"]);
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
    form.set("model", "whisper-1");
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
      model: "tts-1",
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
      model: "gpt-image-1",
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

  it("marks exact reviewed reasoning metadata for a seeded Claude model", async () => {
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

  it("uses a family-rule reasoning fallback for a discovered Claude model", async () => {
    const discovered = await listAnthropicModels({
      env: createEnv(),
      fetch: vi.fn(async () =>
        Response.json({
          data: [{ id: "claude-sonnet-4-6", created_at: "2026-01-01T00:00:00Z" }]
        })
      ) as typeof fetch
    });
    const sonnet = discovered.find((model) => model.id === "anthropic:claude-sonnet-4-6") as {
      capabilities: { chat: { reasoning: { source: string; confidence: string } } };
    };

    expect(sonnet).toBeDefined();
    expect(sonnet.capabilities.chat.reasoning.source).toBe("family-rule");
    expect(sonnet.capabilities.chat.reasoning.confidence).toBe("family");
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
      model: "llama-3.3-70b-versatile",
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
      model: "llama-3.3-70b-versatile",
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

  it("accepts vision input for a vision-capable Groq (Llama 4) model", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "that is an image",
      finishReason: "stop",
      usage: {},
      toolCalls: []
    } as never);

    const response = await postChat(createEnv(), {
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
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
      model: "llama-3.1-8b-instant",
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

  it("handles Groq Orpheus text-to-speech via the transport (no AI SDK speech model)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/audio/speech")) {
          // Assert the request went through CF AI Gateway with the provider key stripped.
          const headers = new Headers(init?.headers);
          expect(headers.get("cf-aig-authorization")).toBe("Bearer cf-token");
          expect(headers.has("authorization")).toBe(false);
          return new Response(new Uint8Array([9, 8, 7]), { headers: { "content-type": "audio/wav" } });
        }
        return Response.json({ data: [] });
      })
    );

    const response = await postJson(createEnv(), "/v1/audio/speech", {
      model: "canopylabs/orpheus-v1-english",
      input: "hello",
      voice: "troy"
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("audio/wav");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
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
      model: "llama-3.3-70b-versatile",
      input: "hello"
    });

    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(embed).not.toHaveBeenCalled();
  });

  it("excludes Groq safety/guard models from the catalog", async () => {
    const discovered = await listGroqModels({
      env: createEnv(),
      fetch: vi.fn(async () =>
        Response.json({
          data: [
            { id: "llama-3.3-70b-versatile", created: 1 },
            { id: "meta-llama/llama-guard-4-12b", created: 2 },
            { id: "meta-llama/llama-prompt-guard-2-86m", created: 3 },
            { id: "openai/gpt-oss-safeguard-20b", created: 4 }
          ]
        })
      ) as typeof fetch
    });

    const ids = discovered.map((model) => model.id);
    expect(ids).toContain("groq:llama-3.3-70b-versatile");
    expect(ids.some((id) => /guard/.test(id))).toBe(false);
  });

  it("marks exact reviewed reasoning metadata for a seeded Groq (gpt-oss) model", async () => {
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

  it("uses a family-rule reasoning fallback for a discovered Groq gpt-oss model", async () => {
    const discovered = await listGroqModels({
      env: createEnv(),
      fetch: vi.fn(async () =>
        Response.json({
          data: [{ id: "openai/gpt-oss-70b", created: 10 }]
        })
      ) as typeof fetch
    });
    const gptOss = discovered.find((model) => model.id === "groq:openai/gpt-oss-70b") as {
      capabilities: { chat: { reasoning: { source: string; confidence: string } } };
    };

    expect(gptOss).toBeDefined();
    expect(gptOss.capabilities.chat.reasoning.source).toBe("family-rule");
    expect(gptOss.capabilities.chat.reasoning.confidence).toBe("family");
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
      model: "grok-4.20-0309-non-reasoning",
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

  it("rejects vision input for a text-only Grok model (grok-3-mini) before calling the provider", async () => {
    const response = await postChat(createEnv(), {
      model: "grok-3-mini",
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

  it("marks exact reviewed reasoning metadata for a seeded Grok model (grok-4.3)", async () => {
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

  it("uses a family-rule reasoning fallback for a discovered Grok reasoning variant", async () => {
    const discovered = await listXaiModels({
      env: createEnv(),
      fetch: vi.fn(async () =>
        Response.json({
          data: [{ id: "grok-4.20-reasoning", created: 10 }]
        })
      ) as typeof fetch
    });
    const grokReasoning = discovered.find((model) => model.id === "xai:grok-4.20-reasoning") as {
      capabilities: { chat: { reasoning: { source: string; confidence: string } } };
    };

    expect(grokReasoning).toBeDefined();
    expect(grokReasoning.capabilities.chat.reasoning.source).toBe("family-rule");
    expect(grokReasoning.capabilities.chat.reasoning.confidence).toBe("family");
  });

  it("declares reasoning unsupported for a non-reasoning Grok variant", async () => {
    const discovered = await listXaiModels({
      env: createEnv(),
      fetch: vi.fn(async () =>
        Response.json({
          data: [{ id: "grok-4.20-0309-non-reasoning", created: 10 }]
        })
      ) as typeof fetch
    });
    const nonReasoning = discovered.find((model) => model.id === "xai:grok-4.20-0309-non-reasoning") as {
      capabilities: { chat: { reasoning: { supported: boolean; source: string; confidence: string } } };
    };

    expect(nonReasoning).toBeDefined();
    expect(nonReasoning.capabilities.chat.reasoning.supported).toBe(false);
    expect(nonReasoning.capabilities.chat.reasoning.confidence).toBe("unknown");
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

  it("marks exact reviewed reasoning metadata for a seeded DeepSeek model (deepseek-v4-flash)", async () => {
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

  it("uses a family-rule reasoning fallback for a discovered DeepSeek v4 model", async () => {
    const discovered = await listDeepSeekModels({
      env: createEnv(),
      fetch: vi.fn(async () =>
        Response.json({
          data: [{ id: "deepseek-v4-turbo", created: 10 }]
        })
      ) as typeof fetch
    });
    const turbo = discovered.find((model) => model.id === "deepseek:deepseek-v4-turbo") as {
      capabilities: { chat: { reasoning: { source: string; confidence: string } } };
    };

    expect(turbo).toBeDefined();
    expect(turbo.capabilities.chat.reasoning.source).toBe("family-rule");
    expect(turbo.capabilities.chat.reasoning.confidence).toBe("family");
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
      model: "gpt-5",
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
      // Groq supports json_schema only on gpt-oss (strict) and llama-4 (best-effort).
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

  it("rejects json_schema on a Groq model that only supports json_object (llama-3.x)", async () => {
    const response = await postChat(createEnv(), {
      model: "llama-3.3-70b-versatile",
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
      model: "gpt-5",
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

  // ── Mistral (OpenAI-wire-compatible: chat + embeddings) ────────────────────

  it("handles a non-streaming Mistral chat completion", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hello from Mistral",
      finishReason: "stop",
      usage: { inputTokens: 3, outputTokens: 4 },
      toolCalls: []
    } as never);

    const response = await postChat(createEnv(), {
      model: "mistral-large-latest",
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
      model: "mistral-large-latest",
      stream: true,
      messages: [{ role: "user", content: "Say hello" }]
    });

    const text = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("Mis");
    expect(text).toContain("[DONE]");
  });

  it("maps Mistral reasoning effort onto the binary none|high option (Magistral)", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "ok", finishReason: "stop", usage: {}, toolCalls: [] } as never);

    await postChat(createEnv(), {
      model: "magistral-medium-latest",
      reasoningEffort: "high",
      messages: [{ role: "user", content: "Think" }]
    });

    const call = vi.mocked(generateText).mock.calls[0][0] as unknown as {
      providerOptions: { mistral: { reasoningEffort?: string } };
    };
    expect(call.providerOptions.mistral.reasoningEffort).toBe("high");
  });

  it("rejects an unsupported reasoning effort on Magistral (only none|high exist)", async () => {
    const response = await postChat(createEnv(), {
      model: "magistral-medium-latest",
      reasoningEffort: "medium",
      messages: [{ role: "user", content: "Think" }]
    });

    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("accepts vision input for a Pixtral model but rejects it for text-only Mistral Large", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "an image", finishReason: "stop", usage: {}, toolCalls: [] } as never);

    const visionMessage = [
      { type: "text" as const, text: "What is this?" },
      { type: "image" as const, image: "data:image/png;base64,abc", mediaType: "image/png" }
    ];

    const pixtral = await postChat(createEnv(), {
      model: "pixtral-large-latest",
      messages: [{ role: "user", content: visionMessage }]
    });
    expect(pixtral.status).toBe(200);

    const large = await postChat(createEnv(), {
      model: "mistral-large-latest",
      messages: [{ role: "user", content: visionMessage }]
    });
    const body = (await large.json()) as { error: { code: string } };
    expect(large.status).toBe(400);
    expect(body.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
  });

  it("handles Mistral embeddings", async () => {
    vi.mocked(embed).mockResolvedValue({ embedding: [0.4, 0.5], usage: { tokens: 2 } } as never);

    const response = await postJson(createEnv(), "/v1/embeddings", {
      model: "mistral-embed",
      input: "hello"
    });

    const body = (await response.json()) as { data: Array<{ embedding: number[] }> };
    expect(response.status).toBe(200);
    expect(body.data[0].embedding).toEqual([0.4, 0.5]);
    expect(embed).toHaveBeenCalledOnce();
  });

  it("uses a family-rule reasoning fallback for a discovered Magistral model", async () => {
    const discovered = await listMistralModels({
      env: createEnv(),
      fetch: vi.fn(async () => Response.json({ data: [{ id: "magistral-medium-2510", created: 1 }] })) as typeof fetch
    });
    const magistral = discovered.find((model) => model.id === "mistral:magistral-medium-2510") as {
      capabilities: { chat: { reasoning: { supported: boolean; source: string; confidence: string; efforts: string[] } } };
    };

    expect(magistral).toBeDefined();
    expect(magistral.capabilities.chat.reasoning.supported).toBe(true);
    expect(magistral.capabilities.chat.reasoning.efforts).toEqual(["none", "high"]);
    expect(magistral.capabilities.chat.reasoning.confidence).toBe("family");
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
      model: "fal-ai/flux/dev",
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
      model: "fal-ai/flux-pro/kontext/max",
      prompt: "make it night",
      images: ["aGVsbG8="]
    });

    expect(response.status).toBe(200);
    const call = vi.mocked(generateImage).mock.calls[0][0] as unknown as { prompt: { images?: unknown[] } };
    expect(Array.isArray(call.prompt.images)).toBe(true);
  });

  it("rejects image editing on a text-to-image-only Fal model", async () => {
    const response = await postJson(createEnv(), "/v1/images/edits", {
      model: "fal-ai/flux/schnell",
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
      model: "luma-ray-2",
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
      model: "minimax-video-01",
      prompt: "animate this",
      image: "data:image/png;base64,aGVsbG8="
    });

    const call = vi.mocked(experimental_generateVideo).mock.calls[0][0] as unknown as { prompt: { image?: unknown } };
    expect(call.prompt.image).toBeDefined();
  });

  it("handles Fal text-to-speech", async () => {
    vi.mocked(experimental_generateSpeech).mockResolvedValue({
      audio: { uint8Array: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" }
    } as never);

    const response = await postJson(createEnv(), "/v1/audio/speech", {
      model: "fal-ai/minimax/speech-02-hd",
      input: "hello",
      voice: "default"
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("audio/mpeg");
    expect(experimental_generateSpeech).toHaveBeenCalledOnce();
  });

  it("handles Fal speech-to-text transcription", async () => {
    vi.mocked(experimental_transcribe).mockResolvedValue({
      text: "hello fal audio",
      language: "en",
      durationInSeconds: 1,
      segments: []
    } as never);

    const form = new FormData();
    form.set("model", "wizper");
    form.set("file", new File([new Uint8Array([1, 2, 3])], "s.wav", { type: "audio/wav" }));

    const response = await worker.fetch(
      new Request("https://gateway.test/v1/audio/transcriptions", { method: "POST", body: form }),
      createEnv(),
      {} as ExecutionContext
    );

    const body = (await response.json()) as { text: string };
    expect(response.status).toBe(200);
    expect(body.text).toBe("hello fal audio");
  });

  // ── Replicate (media: image gen/edit, video) ───────────────────────────────

  it("handles Replicate image generation", async () => {
    vi.mocked(generateImage).mockResolvedValue({
      images: [{ base64: "cmVw", uint8Array: new Uint8Array([1]), mediaType: "image/png" }],
      usage: {}
    } as never);

    const response = await postJson(createEnv(), "/v1/images/generations", {
      model: "black-forest-labs/flux-schnell",
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
      model: "black-forest-labs/flux-fill-pro",
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
      model: "minimax/video-01",
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
    form.set("model", "scribe_v1");
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
