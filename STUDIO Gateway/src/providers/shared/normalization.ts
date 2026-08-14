/**
 * Shared OpenAI normalization — converts AI SDK outputs to OpenAI-compatible JSON/SSE.
 * Keeps reasoning, tools, vision, and usage handling consistent across all providers.
 */

export function buildChatCompletionObject(
  id: string,
  model: string,
  text: string,
  opts: {
    reasoning?: string;
    toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    finishReason: string;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  },
): Record<string, unknown> {
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
          ...(opts.reasoning ? { reasoning_content: opts.reasoning } : {}),
          ...(opts.toolCalls && opts.toolCalls.length > 0 ? { tool_calls: opts.toolCalls } : {}),
        },
        finish_reason: opts.finishReason,
      },
    ],
    ...(opts.usage ? { usage: opts.usage } : {}),
  };
}

/** @deprecated — use buildChatCompletionObject */
export const toOpenAIChatCompletion = buildChatCompletionObject;

export function mapFinishReason(providerReason: string | undefined): string {
  if (!providerReason) return "stop";
  const lower = providerReason.toLowerCase();
  if (lower.includes("length") || lower.includes("max_tokens")) return "length";
  if (lower.includes("tool")) return "tool_calls";
  if (lower.includes("content_filter") || lower.includes("refusal")) return "content_filter";
  if (lower.includes("stop")) return "stop";
  return lower;
}

// Embedding normalization
export function toOpenAIEmbeddings(model: string, embeddings: number[][], usage?: { tokens: number }): Record<string, unknown> {
  return {
    object: "list",
    data: embeddings.map((emb, idx) => ({
      object: "embedding",
      index: idx,
      embedding: emb,
    })),
    model,
    usage: usage ? { prompt_tokens: usage.tokens, total_tokens: usage.tokens } : undefined,
  };
}

// Image normalization
export function toOpenAIImages(images: Array<{ b64_json?: string; url?: string }>): Record<string, unknown> {
  return {
    created: Math.floor(Date.now() / 1000),
    data: images,
  };
}
