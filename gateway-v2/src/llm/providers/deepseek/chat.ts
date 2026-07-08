import { generateText, streamText, Output, jsonSchema } from "ai";
import { createSseResponse, encodeSse } from "../../../core/streaming";
import type { CapturedUsage, ChatRequest, ChatResponse, ToolCall } from "../../../core/types";
import type { HandlerContext } from "../../../core/registry";
import { mapProviderError } from "../../../core/errors";
import { createDeepSeekClient } from "./client";
import type { ReasoningEffort } from "../../../core/capabilities";

export async function deepseekChat(request: ChatRequest, context: HandlerContext): Promise<ChatResponse | Response> {
  try {
    const provider = createDeepSeekClient(context);
    const model = provider.chat(request.model as never);
    const call = {
      model,
      messages: toAiMessages(request),
      temperature: request.temperature,
      topP: request.topP,
      maxOutputTokens: request.maxTokens,
      tools: toAiTools(request),
      toolChoice: toAiToolChoice(request.toolChoice),
      experimental_output: toStructuredOutput(request),
      abortSignal: context.request.signal,
      providerOptions: {
        deepseek: toDeepSeekProviderOptions(request)
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
      provider: "deepseek",
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
  // DeepSeek is text-only (no vision), but the image-part mapping is retained for shape
  // parity with the other providers — validation rejects image input before we reach here.
  return request.messages.map((message) => ({
    role: message.role,
    content: Array.isArray(message.content)
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
      : message.content,
    name: message.name,
    toolCallId: message.toolCallId
  }));
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

// Enforces `response_format: json_schema` by passing the schema to the model via the AI
// SDK's structured-output mechanism (DeepSeek is OpenAI-wire-compatible and honors
// json_schema on its chat models — see supportsDeepSeekJsonSchema). Validation has
// already confirmed support. The model still returns JSON text, so the chat.completion
// shape and streamed text-deltas are unchanged. `json_object` has no schema to enforce.
export function toStructuredOutput(request: ChatRequest) {
  const format = request.responseFormat;
  if (format?.type !== "json_schema" || !format.json_schema) return undefined;
  const spec = format.json_schema as { name?: unknown; schema?: unknown };
  const schema = (spec.schema ?? spec) as Parameters<typeof jsonSchema>[0];
  return Output.object({
    schema: jsonSchema(schema),
    name: typeof spec.name === "string" ? spec.name : undefined
  });
}

// Builds the @ai-sdk/deepseek provider options, mapping the gateway ReasoningEffort
// scale onto DeepSeek's two reasoning controls:
//   • providerOptions.deepseek.thinking: { type: 'adaptive'|'enabled'|'disabled' }
//   • providerOptions.deepseek.reasoningEffort: 'low'|'medium'|'high'|'xhigh'|'max'
//
// Gateway scale → DeepSeek mapping (validation has already confirmed the model supports
// the requested effort before we reach here):
//   • 'none'     → thinking disabled, no reasoningEffort (disables reasoning entirely)
//   • 'minimal'  → thinking enabled, reasoningEffort 'low' (DeepSeek has no 'minimal')
//   • 'low'|'medium'|'high'|'xhigh' → pass through reasoningEffort, thinking enabled
//   • (the gateway 'max' value is not user-facing; if requested it maps to 'max')
function toDeepSeekProviderOptions(request: ChatRequest): Record<string, unknown> {
  const options: Record<string, unknown> = {};

  const effort = request.reasoningEffort;
  if (effort) {
    const mapped = mapEffort(effort);
    if (mapped.thinking) {
      options.thinking = mapped.thinking;
    }
    if (mapped.reasoningEffort) {
      options.reasoningEffort = mapped.reasoningEffort;
    }
  }

  return options;
}

function mapEffort(effort: ReasoningEffort): { thinking?: { type: "adaptive" | "enabled" | "disabled" }; reasoningEffort?: string } {
  switch (effort) {
    case "none":
      return { thinking: { type: "disabled" } };
    case "minimal":
      // DeepSeek has no 'minimal'; enable thinking + lowest reasoning_effort.
      return { thinking: { type: "enabled" }, reasoningEffort: "low" };
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return { thinking: { type: "enabled" }, reasoningEffort: effort };
    default:
      return { thinking: { type: "adaptive" } };
  }
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
