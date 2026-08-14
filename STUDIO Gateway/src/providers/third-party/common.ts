/**
 * Third-party common runtime — OpenAI-compatible via AI SDK.
 * Handles all 17+ providers not covered by first-party SDKs.
 * Quirks are applied per-provider via shared quirks table.
 *
 * AI SDK @ai-sdk/openai-compatible@3.0.30 exposes:
 *   provider(modelId) / provider.chatModel() -> LanguageModelV4
 *   provider.embeddingModel() / provider.textEmbeddingModel() -> EmbeddingModelV4
 *   provider.imageModel() -> ImageModelV4
 * Verified against node_modules/@ai-sdk/openai-compatible/dist/index.d.ts
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText, generateImage, embed, embedMany } from "ai";
import type { ChatRequest, EmbeddingRequest, ImageRequest } from "../contract.ts";
import { openAIToolsToAISDKTools, normalizeMessagesForSDK, resolveReasoning } from "../shared/runtime.ts";
import { mapFinishReason, toOpenAIEmbeddings } from "../shared/normalization.ts";
import { applyQuirk } from "../quirks.ts";
import { notImplemented } from "../../lib/errors.ts";
import { aiSdkStreamToResponse, stableCompletionId } from "../shared/sse.ts";

export function createThirdPartyRuntime(providerId: string, apiKey: string, baseUrl: string) {
  return createOpenAICompatible({
    name: providerId,
    apiKey,
    baseURL: baseUrl,
    // Ensure compatibility with providers that require custom transforms — quirks handle body patches
  });
}

export async function thirdPartyChat(providerId: string, req: ChatRequest): Promise<Response> {
  if (req.reasoning?.mode === "budget") throw notImplemented(`Provider ${providerId} does not support exact budget reasoning — use adaptive levels`);
  // Apply quirks to OpenAI body before SDK translation — preserves per-provider compatibility
  const patchedBody = applyQuirk(providerId, req.body as Record<string, unknown>);
  const messages = normalizeMessagesForSDK((patchedBody.messages as never) ?? (req.body.messages as never)) as never;
  const tools = openAIToolsToAISDKTools((patchedBody.tools as never) ?? (req.body.tools as never));
  const reasoningOpt = resolveReasoning(req.reasoning);
  const model = createThirdPartyRuntime(providerId, req.apiKey, req.provider.baseUrl)(req.model.id);
  const isStream = (patchedBody.stream as boolean) ?? (req.body.stream === true);

  const maxOutputTokens = (patchedBody.max_tokens as number) ?? (patchedBody.max_completion_tokens as number) ?? undefined;
  const temperature = patchedBody.temperature as number | undefined;
  const topP = patchedBody.top_p as number | undefined;
  const stop = patchedBody.stop as string | string[] | undefined;

  if (!isStream) {
    const result = await (generateText as any)({
      model,
      messages: messages as never,
      tools: tools as never,
      abortSignal: req.signal,
      ...(reasoningOpt.reasoning ? { reasoning: reasoningOpt.reasoning as never } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { topP } : {}),
      ...(stop !== undefined ? { stopSequences: Array.isArray(stop) ? stop : [stop] } : {}),
    });
    const text = result.text ?? "";
    const finish = mapFinishReason(result.finishReason);
    const payload = {
      id: stableCompletionId(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: req.model.id,
      choices: [{ index: 0, message: { role: "assistant", content: text, ...(result.reasoningText ? { reasoning_content: result.reasoningText } : {}) }, finish_reason: finish }],
      ...(result.usage ? { usage: { prompt_tokens: result.usage.inputTokens ?? 0, completion_tokens: result.usage.outputTokens ?? 0, total_tokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0) } } : {}),
    };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }

  const result = (streamText as any)({
    model,
    messages: messages as never,
    tools: tools as never,
    abortSignal: req.signal,
    ...(reasoningOpt.reasoning ? { reasoning: reasoningOpt.reasoning as never } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { topP } : {}),
    ...(stop !== undefined ? { stopSequences: Array.isArray(stop) ? stop : [stop] } : {}),
  });

  return aiSdkStreamToResponse(result.fullStream, req.model.id, req.signal);
}

export async function thirdPartyImage(providerId: string, req: ImageRequest): Promise<Response> {
  const provider = createThirdPartyRuntime(providerId, req.apiKey, req.provider.baseUrl) as unknown as {
    imageModel: (id: string) => unknown;
  };
  if (typeof provider.imageModel !== "function") {
    throw notImplemented(`Image generation is not supported for provider ${providerId} (provider.imageModel missing @ai-sdk/openai-compatible@3.0.30)`);
  }
  const model = provider.imageModel(req.model.id);
  const result = await (generateImage as any)({
    model,
    prompt: req.prompt,
    n: (req.body.n as number) ?? 1,
    size: req.body.size as string | undefined,
    providerOptions: {
      openaiCompatible: {
        ...(req.body.size ? { size: req.body.size as string } : {}),
        ...(req.body.quality ? { quality: req.body.quality as string } : {}),
        ...(req.body.style ? { style: req.body.style as string } : {}),
      },
    },
  });
  const images = (result.images ?? []).map((img: any) => {
    const b64 = (img as { base64?: string; b64_json?: string }).base64 ?? (img as { b64_json?: string }).b64_json;
    const url = (img as { url?: string }).url;
    if (url) return { url, b64_json: b64 };
    return { b64_json: b64, url: undefined };
  });
  return new Response(JSON.stringify({ created: Math.floor(Date.now() / 1000), data: images }), { status: 200, headers: { "content-type": "application/json" } });
}

export async function thirdPartyEmbed(providerId: string, req: EmbeddingRequest): Promise<Response> {
  const provider = createThirdPartyRuntime(providerId, req.apiKey, req.provider.baseUrl) as unknown as {
    embeddingModel: (id: string) => unknown;
    textEmbeddingModel?: (id: string) => unknown;
  };
  const embeddingFactory = provider.embeddingModel ?? provider.textEmbeddingModel;
  if (typeof embeddingFactory !== "function") {
    throw notImplemented(`Embeddings not supported for provider ${providerId} (provider.embeddingModel missing @ai-sdk/openai-compatible@3.0.30)`);
  }
  const model = embeddingFactory(req.model.id);
  const values = Array.isArray(req.input) ? req.input : [req.input];
  const providerOptions = typeof req.body.dimensions === "number" ? { openaiCompatible: { dimensions: req.body.dimensions as number } } : undefined;
  if (values.length === 1) {
    const { embedding, usage } = await (embed as any)({ model, value: values[0], ...(providerOptions ? { providerOptions } : {}) });
    return new Response(JSON.stringify(toOpenAIEmbeddings(req.model.id, [embedding], usage ? { tokens: usage.tokens } : undefined)), { status: 200, headers: { "content-type": "application/json" } });
  }
  const { embeddings, usage } = await (embedMany as any)({ model, values, ...(providerOptions ? { providerOptions } : {}) });
  return new Response(JSON.stringify(toOpenAIEmbeddings(req.model.id, embeddings, usage ? { tokens: usage.tokens } : undefined)), { status: 200, headers: { "content-type": "application/json" } });
}
