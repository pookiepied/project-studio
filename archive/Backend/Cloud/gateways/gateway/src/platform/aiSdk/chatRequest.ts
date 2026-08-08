import { Output, jsonSchema } from "ai";
import type { ChatMessage, ChatRequest } from "@/domain/contracts";

export function toAiMessages(request: ChatRequest) {
  return request.messages.map((message) => {
    if (message.role === "tool") return toAiToolResultMessage(message);
    if (message.role === "assistant" && message.toolCalls?.length) {
      return toAiAssistantToolCallMessage(message);
    }

    return {
      role: message.role,
      content: toAiContent(message.content),
      name: message.name,
      toolCallId: message.toolCallId
    };
  });
}

function toAiContent(content: ChatMessage["content"]) {
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (part.type !== "image") return part;
    const normalized = normalizeImageInput(part.image, part.mediaType);
    return { type: "image", image: normalized.image, mediaType: normalized.mediaType };
  });
}

function textOf(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * A tool result must name the call it answers so the provider can pair it with
 * the assistant turn that requested it.
 */
function toAiToolResultMessage(message: ChatMessage) {
  return {
    role: "tool" as const,
    content: [
      {
        type: "tool-result" as const,
        toolCallId: message.toolCallId ?? "",
        toolName: message.toolName ?? message.name ?? "",
        output: { type: "text" as const, value: textOf(message.content) }
      }
    ]
  };
}

/**
 * Replays a previous assistant turn's tool calls. Every call is preserved in
 * its original order so the following tool results stay correlated.
 */
function toAiAssistantToolCallMessage(message: ChatMessage) {
  const text = textOf(message.content);
  return {
    role: "assistant" as const,
    content: [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...(message.toolCalls ?? []).map((call) => ({
        type: "tool-call" as const,
        toolCallId: call.id,
        toolName: call.name,
        input: parseToolArguments(call.arguments)
      }))
    ]
  };
}

function parseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function normalizeImageInput(
  image: string,
  mediaType?: string
): { image: string | URL; mediaType?: string } {
  if (/^https?:\/\//i.test(image)) return { image: new URL(image), mediaType };

  const dataUrlMatch = /^data:([^;,]+)?;base64,(.+)$/i.exec(image);
  if (dataUrlMatch) {
    return {
      image: dataUrlMatch[2],
      mediaType: mediaType ?? dataUrlMatch[1] ?? "image/png"
    };
  }
  return { image, mediaType: mediaType ?? "image/png" };
}

export function toAiTools(request: ChatRequest) {
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

export function toAiToolChoice(toolChoice: ChatRequest["toolChoice"]) {
  if (!toolChoice || typeof toolChoice === "string") return toolChoice;
  const functionName = (toolChoice as { function?: { name?: string } }).function?.name;
  return functionName ? { type: "tool" as const, toolName: functionName } : "auto";
}

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
