import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText, generateImage, embed, embedMany, generateSpeech, transcribe } from "ai";
import type { ChatRequest, EmbeddingRequest, ImageRequest, SpeechRequest, TranscriptionRequest } from "../contract.ts";
import { openAIToolsToAISDKTools, normalizeMessagesForSDK, resolveReasoning } from "../shared/runtime.ts";
import { mapFinishReason, toOpenAIEmbeddings } from "../shared/normalization.ts";
import { aiSdkStreamToResponse, stableCompletionId } from "../shared/sse.ts";
import { notImplemented, badRequest } from "../../lib/errors.ts";

export function createOpenAIRuntime(apiKey: string, baseUrl?: string) {
  return createOpenAI({ apiKey, baseURL: baseUrl || undefined });
}

export async function openAIChat(req: ChatRequest): Promise<Response> {
  const { body, apiKey, provider, signal } = req;
  if (req.reasoning?.mode === "budget") throw notImplemented("OpenAI does not support exact budget reasoning — use adaptive levels");
  const openai = createOpenAIRuntime(apiKey, provider.baseUrl);
  // OpenAI provider auto-selects Responses vs Chat based on model id
  const model = openai(req.model.id);
  const tools = openAIToolsToAISDKTools(body.tools as never);
  const messages = normalizeMessagesForSDK(body.messages as never) as never;
  const reasoningOpt = resolveReasoning(req.reasoning);
  const isStream = body.stream === true;

  if (!isStream) {
    const result = await (generateText as any)({
      model,
      messages: messages as never,
      tools: tools as never,
      abortSignal: signal,
      ...(reasoningOpt.reasoning ? { reasoning: reasoningOpt.reasoning as never } : {}),
    });
    const text = result.text ?? "";
    const finish = mapFinishReason(result.finishReason);
    const payload = {
      id: stableCompletionId(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: req.model.id,
      choices: [{ index: 0, message: { role: "assistant", content: text, ...(result.reasoningText ? { reasoning_content: result.reasoningText } : {}), ...(result.toolCalls && result.toolCalls.length > 0 ? { tool_calls: result.toolCalls.map((tc: any) => ({ id: tc.toolCallId, type: "function", function: { name: tc.toolName, arguments: JSON.stringify(tc.input ?? {}) } })) } : {}) }, finish_reason: finish }],
      ...(result.usage ? { usage: { prompt_tokens: result.usage.inputTokens ?? 0, completion_tokens: result.usage.outputTokens ?? 0, total_tokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0) } } : {}),
    };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }

  const result = (streamText as any)({
    model,
    messages: messages as never,
    tools: tools as never,
    abortSignal: signal,
    ...(reasoningOpt.reasoning ? { reasoning: reasoningOpt.reasoning as never } : {}),
  });

  return aiSdkStreamToResponse(result.fullStream, req.model.id, req.signal);
}

export async function openAIImage(req: ImageRequest): Promise<Response> {
  const openai = createOpenAIRuntime(req.apiKey, req.provider.baseUrl);
  const result = await (generateImage as any)({
    model: openai.image(req.model.id),
    prompt: req.prompt,
    n: (req.body.n as number) ?? 1,
    size: req.body.size as any | undefined,
    providerOptions: { openai: { quality: req.body.quality as string | undefined, style: req.body.style as string | undefined } },
  });
  const images = (result.images ?? []).map((img: any) => ({ b64_json: (img as any).base64 }));
  return new Response(JSON.stringify({ created: Math.floor(Date.now() / 1000), data: images }), { status: 200, headers: { "content-type": "application/json" } });
}

export async function openAIEmbed(req: EmbeddingRequest): Promise<Response> {
  const openai = createOpenAIRuntime(req.apiKey, req.provider.baseUrl);
  const values = Array.isArray(req.input) ? req.input : [req.input];
  const model = openai.embedding(req.model.id);
  if (values.length === 1) {
    const { embedding, usage } = await (embed as any)({ model, value: values[0] });
    return new Response(JSON.stringify(toOpenAIEmbeddings(req.model.id, [embedding], usage ? { tokens: usage.tokens } : undefined)), { status: 200, headers: { "content-type": "application/json" } });
  }
  const { embeddings, usage } = await (embedMany as any)({ model, values });
  return new Response(JSON.stringify(toOpenAIEmbeddings(req.model.id, embeddings, usage ? { tokens: usage.tokens } : undefined)), { status: 200, headers: { "content-type": "application/json" } });
}

export async function openAISpeech(req: SpeechRequest): Promise<Response> {
  const openai = createOpenAIRuntime(req.apiKey, req.provider.baseUrl);
  const result = await generateSpeech({
    model: openai.speech(req.model.id as never),
    text: req.input,
    voice: (req.voice as never) ?? "alloy",
  });
  // AI SDK returns audio object with base64 / uint8Array
  const audio = result.audio as { base64?: string; uint8Array?: Uint8Array; mediaType?: string };
  const bytes = audio.uint8Array ? audio.uint8Array : audio.base64 ? Uint8Array.from(atob(audio.base64), (c) => c.charCodeAt(0)) : new Uint8Array();
  return new Response(bytes, { status: 200, headers: { "content-type": audio.mediaType ?? "audio/mpeg" } });
}

export async function openAITranscribe(req: TranscriptionRequest): Promise<Response> {
  const openai = createOpenAIRuntime(req.apiKey, req.provider.baseUrl);
  const file = req.form.get("file") as File | null;
  if (!file) throw badRequest("file is required for transcription");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await transcribe({
    model: openai.transcription(req.model.id as never),
    audio: bytes,
  });
  return new Response(JSON.stringify({ text: result.text }), { status: 200, headers: { "content-type": "application/json" } });
}
