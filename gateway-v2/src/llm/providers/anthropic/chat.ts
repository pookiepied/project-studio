import { generateText, streamText } from "ai";
import { mapProviderError } from "../../../core/errors";
import { createSseResponse, encodeSse } from "../../../core/streaming";
import type { ReasoningEffort } from "../../../core/capabilities";
import type { CapturedUsage, ChatRequest, ChatResponse, ToolCall } from "../../../core/types";
import type { HandlerContext } from "../../../core/registry";
import { createAnthropicClient } from "./client";

export async function anthropicChat(request: ChatRequest, context: HandlerContext): Promise<ChatResponse | Response> {
  try {
    const provider = createAnthropicClient(context);
    const call = {
      model: provider(request.model as never),
      messages: toAiMessages(request),
      temperature: request.temperature,
      topP: request.topP,
      maxOutputTokens: request.maxTokens,
      tools: toAiTools(request),
      toolChoice: toAiToolChoice(request.toolChoice),
      abortSignal: context.request.signal,
      providerOptions: {
        anthropic: {
          thinking: toAnthropicThinking(request)
        }
      }
    };

    if (request.stream) {
      const result = streamText(call as never);
      return createSseResponse(async (writer) => {
        const toolCalls: ToolCall[] = [];
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            await writer.write(encodeSse({ type: "content", chunk: textFromPart(part) }));
          } else if (part.type === "reasoning-delta") {
            const chunk = textFromPart(part);
            if (chunk) {
              await writer.write(encodeSse({ type: "reasoning", chunk }));
            }
          } else if (part.type === "tool-call") {
            toolCalls.push(toGatewayToolCall(part));
          } else if (part.type === "finish") {
            const usage = usageFromAiSdk((part as { totalUsage?: unknown }).totalUsage);
            if (usage) {
              await writer.write(encodeSse({ type: "usage", data: usage }));
            }
          }
        }
        if (toolCalls.length) {
          await writer.write(encodeSse({ type: "tool_calls", calls: toolCalls }));
        }
        await writer.write(encodeSse("[DONE]"));
      });
    }

    const result = await generateText(call as never);
    return {
      id: `chatcmpl_${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      provider: "anthropic",
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
  } catch (error) {
    throw mapProviderError(error);
  }
}

function toAiMessages(request: ChatRequest) {
  // A single ephemeral cache_control breakpoint is placed on the final message when the
  // caller opts into prompt caching (via promptCacheKey). Anthropic caches by prefix
  // match, so this caches everything up to and including the last turn. Validation has
  // already confirmed the model supports prompt caching before we reach here.
  const cachingEnabled = Boolean(request.promptCacheKey);
  const lastIndex = request.messages.length - 1;

  return request.messages.map((message, index) => {
    const content = Array.isArray(message.content)
      ? message.content.map((part) => {
          if (part.type === "image") {
            const normalized = normalizeImageInput(part.image, part.mediaType);
            return {
              type: "image",
              image: normalized.image,
              mediaType: normalized.mediaType
            };
          }
          return part;
        })
      : message.content;

    return {
      role: message.role,
      content,
      name: message.name,
      toolCallId: message.toolCallId,
      ...(cachingEnabled && index === lastIndex
        ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
        : {})
    };
  });
}

function normalizeImageInput(image: string, mediaType?: string): { image: string | URL; mediaType?: string } {
  if (/^https?:\/\//i.test(image)) {
    return { image: new URL(image), mediaType };
  }

  const dataUrlMatch = /^data:([^;,]+)?;base64,(.+)$/i.exec(image);
  if (dataUrlMatch) {
    return {
      image: dataUrlMatch[2],
      mediaType: mediaType ?? dataUrlMatch[1] ?? "image/png"
    };
  }

  return {
    image,
    mediaType: mediaType ?? "image/png"
  };
}

function toAiTools(request: ChatRequest) {
  if (!request.tools?.length) return undefined;

  return Object.fromEntries(
    request.tools.map((tool) => [
      tool.function.name,
      {
        description: tool.function.description,
        inputSchema: tool.function.parameters ?? { type: "object", properties: {} }
      }
    ])
  );
}

function toAiToolChoice(toolChoice: ChatRequest["toolChoice"]) {
  if (!toolChoice || typeof toolChoice === "string") return toolChoice;
  const functionName = (toolChoice as { function?: { name?: string } }).function?.name;
  return functionName ? { type: "tool" as const, toolName: functionName } : "auto";
}

// Maps the gateway's normalized ReasoningEffort scale onto Anthropic extended thinking.
// Anthropic controls thinking depth with a `budget_tokens` count, so each effort level
// maps to a budget. `none` (and no effort) disables thinking.
//
// NOTE (flagged for review): the newest Claude models (Opus 4.6+, Sonnet 5, Fable 5)
// prefer *adaptive* thinking and reject an explicit `budget_tokens` at the raw API.
// GATEWAY_GUIDE.md / the task specify mapping effort → budget_tokens, so that mapping is
// implemented here; the AI SDK is expected to translate it, but this is the one place a
// per-tier adaptive/budget split may need revisiting.
const REASONING_BUDGET_TOKENS: Record<Exclude<ReasoningEffort, "none">, number> = {
  minimal: 1024,
  low: 4000,
  medium: 8000,
  high: 16000,
  xhigh: 24000
};

function toAnthropicThinking(request: ChatRequest) {
  const effort = request.reasoningEffort;
  if (!effort || effort === "none") return undefined;
  const budgetTokens = request.reasoningBudget ?? REASONING_BUDGET_TOKENS[effort];
  return { type: "enabled" as const, budgetTokens };
}

function textFromPart(part: unknown): string {
  const candidate = part as { text?: string; textDelta?: string; delta?: string };
  return candidate.text ?? candidate.textDelta ?? candidate.delta ?? "";
}

function toGatewayToolCall(part: unknown): ToolCall {
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

function usageFromAiSdk(usage: unknown): CapturedUsage | undefined {
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
