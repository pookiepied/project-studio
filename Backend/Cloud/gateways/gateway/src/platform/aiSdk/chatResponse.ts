import type { CapturedUsage, ChatResponse, ProviderId, ToolCall } from "@/domain/contracts";

interface AiSdkTextResult {
  text?: string;
  finishReason?: string;
  toolCalls?: unknown[];
  usage?: unknown;
}

export function createChatResponse(
  provider: ProviderId,
  model: string,
  result: AiSdkTextResult
): ChatResponse {
  return {
    id: `chatcmpl_${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    provider,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: result.text || null,
          tool_calls: result.toolCalls?.length ? result.toolCalls.map(toGatewayToolCall) : undefined
        },
        finish_reason: result.finishReason ?? null
      }
    ],
    usage: usageFromAiSdk(result.usage)
  };
}

export function toGatewayToolCall(part: unknown): ToolCall {
  const candidate = part as {
    toolCallId?: string;
    id?: string;
    toolName?: string;
    input?: unknown;
    args?: unknown;
    function?: { name?: string; arguments?: string };
  };
  const name = candidate.toolName ?? candidate.function?.name ?? "unknown_tool";
  const input = candidate.input ?? candidate.args ?? candidate.function?.arguments ?? {};
  return {
    id: candidate.toolCallId ?? candidate.id ?? `call_${crypto.randomUUID()}`,
    type: "function",
    function: {
      name,
      arguments: typeof input === "string" ? input : JSON.stringify(input)
    }
  };
}

export function usageFromAiSdk(usage: unknown): CapturedUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const value = usage as {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    inputTokenDetails?: {
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
    outputTokenDetails?: {
      reasoningTokens?: number;
    };
  };
  return {
    prompt_tokens: value.inputTokens,
    completion_tokens: value.outputTokens,
    total_tokens: value.totalTokens,
    cache_read_input_tokens: value.inputTokenDetails?.cacheReadTokens,
    cache_creation_input_tokens: value.inputTokenDetails?.cacheWriteTokens,
    reasoning_tokens: value.outputTokenDetails?.reasoningTokens
  };
}
