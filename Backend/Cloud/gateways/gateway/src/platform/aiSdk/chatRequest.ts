import { Output, jsonSchema } from "ai";
import type { ChatRequest } from "@/domain/contracts";

export function toAiMessages(request: ChatRequest) {
  return request.messages.map((message) => ({
    role: message.role,
    content: Array.isArray(message.content)
      ? message.content.map((part) => {
          if (part.type !== "image") return part;
          const normalized = normalizeImageInput(part.image, part.mediaType);
          return { type: "image", image: normalized.image, mediaType: normalized.mediaType };
        })
      : message.content,
    name: message.name,
    toolCallId: message.toolCallId
  }));
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
