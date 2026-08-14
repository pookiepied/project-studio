/**
 * Shared SSE helpers — canonical for OpenAI chat streaming.
 * Single source for stable stream IDs and OpenAI chunk encoding.
 * AI SDK providers (anthropic/google/openai/third-party) all use this.
 */

import { mapFinishReason } from "./normalization.ts";

// Stable per-request ID — crypto.randomUUID is synchronously available in Workers
export function stableStreamId(prefix = "chatcmpl"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function stableCompletionId(prefix = "chatcmpl"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function openAIChunk(id: string, model: string, delta: Record<string, unknown>, finish?: string | null): string {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  })}\n\n`;
}

export function openAIDone(): string {
  return "data: [DONE]\n\n";
}

/**
 * Bridge AI SDK `streamText` fullStream to OpenAI SSE Response.
 * Deduplicates 4 provider SDKs (anthropic/google/openai/common.ts).
 */
export function aiSdkStreamToResponse(
  fullStream: AsyncIterable<unknown>,
  modelId: string,
  signal?: AbortSignal,
): Response {
  const streamId = stableStreamId();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let sentRole = false;
      const onAbort = () => {
        try { controller.error(new DOMException("Aborted", "AbortError")); } catch {}
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        for await (const part of fullStream as AsyncIterable<Record<string, unknown>>) {
          if (signal?.aborted) break;
          const type = part.type as string;
          if (type === "text-delta") {
            const text = (part as { text?: string }).text ?? (part as { delta?: string }).delta ?? "";
            if (!text) continue;
            controller.enqueue(encoder.encode(openAIChunk(streamId, modelId, { ...(sentRole ? {} : { role: "assistant" }), content: text })));
            sentRole = true;
          } else if (type === "reasoning-delta") {
            const text = (part as { text?: string }).text ?? "";
            if (!text) continue;
            controller.enqueue(encoder.encode(openAIChunk(streamId, modelId, { reasoning_content: text })));
          } else if (type === "tool-call") {
            const tc = part as { toolCallId: string; toolName: string; input: unknown };
            controller.enqueue(encoder.encode(openAIChunk(streamId, modelId, { tool_calls: [{ id: tc.toolCallId, type: "function", function: { name: tc.toolName, arguments: JSON.stringify(tc.input ?? {}) } }] })));
            sentRole = true;
          } else if (type === "finish") {
            const finish = mapFinishReason((part as { finishReason?: string }).finishReason);
            controller.enqueue(encoder.encode(openAIChunk(streamId, modelId, {}, finish)));
          } else if (type === "error") {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: (part as { error: unknown }).error })}\n\n`));
          }
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
      controller.enqueue(encoder.encode(openAIDone()));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

export function buildChatCompletionResponse(
  modelId: string,
  text: string,
  finishReason: string | undefined,
  reasoningText: string | undefined,
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>,
): Response {
  const finish = mapFinishReason(finishReason);
  const payload: Record<string, unknown> = {
    id: stableCompletionId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text,
        ...(reasoningText ? { reasoning_content: reasoningText } : {}),
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls.map((tc) => ({ id: tc.toolCallId, type: "function", function: { name: tc.toolName, arguments: JSON.stringify(tc.input ?? {}) } })) } : {}),
      },
      finish_reason: finish,
    }],
    ...(usage ? { usage: { prompt_tokens: usage.inputTokens ?? 0, completion_tokens: usage.outputTokens ?? 0, total_tokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) } } : {}),
  };
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

/** @deprecated — use buildChatCompletionResponse */
export const toOpenAIChatCompletion = buildChatCompletionResponse;
