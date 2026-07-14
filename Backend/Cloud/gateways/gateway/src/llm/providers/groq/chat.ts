import { generateText, streamText, Output, jsonSchema } from "ai";
import { createSseResponse, encodeSse } from "../../../core/streaming";
import type { CapturedUsage, ChatRequest, ChatResponse, ToolCall } from "../../../core/types";
import type { HandlerContext } from "../../../core/registry";
import { mapProviderError } from "../../../core/errors";
import { createGroqClient } from "./client";

export async function groqChat(request: ChatRequest, context: HandlerContext): Promise<ChatResponse | Response> {
  try {
    const provider = createGroqClient(context);
    const model = provider(request.model as never);
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
        groq: toGroqProviderOptions(request)
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
      provider: "groq",
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

// Enforces `response_format: json_schema` by passing the schema to the model via the AI SDK's
// structured-output mechanism (Groq is OpenAI-wire-compatible and honors json_schema on its
// tool-capable models — see supportsGroqJsonSchema). Validation has already confirmed support.
// The model still returns JSON text, so the chat.completion shape and streamed text-deltas are
// unchanged. `json_object` (schemaless) has no schema to enforce.
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

// Builds the @ai-sdk/groq provider options, gating each quirk per model:
//   • gpt-oss-120b: NO parallel tool calls (Groq docs) → parallelToolCalls=false.
//   • Reasoning effort: GPT-OSS accepts low|medium|high directly; Qwen3 reasoning is on/off,
//     so any gateway effort other than "none" collapses to Groq's "default". Validation has
//     already confirmed the model supports the requested effort before we reach here.
function toGroqProviderOptions(request: ChatRequest): Record<string, unknown> {
  const modelId = request.model;
  const options: Record<string, unknown> = {
    user: request.user,
    strictJsonSchema: request.responseFormat?.type === "json_schema" ? true : undefined
  };

  if (/gpt-oss-120b/i.test(modelId)) {
    options.parallelToolCalls = false;
  }

  const effort = request.reasoningEffort;
  if (effort) {
    if (/gpt-oss/i.test(modelId)) {
      // GPT-OSS uses reasoning_effort low|medium|high; drop none/minimal it cannot express.
      if (effort === "low" || effort === "medium" || effort === "high") {
        options.reasoningEffort = effort;
      }
    } else {
      // Qwen3 / QwQ / DeepSeek-R1: on/off reasoning. Separate reasoning from content.
      options.reasoningEffort = effort === "none" ? "none" : "default";
      options.reasoningFormat = "parsed";
    }
  }

  return options;
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
