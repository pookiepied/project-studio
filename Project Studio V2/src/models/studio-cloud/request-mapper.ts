import type {
  Api,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import { DEFAULT_MODEL_NAME, STUDIO_MODEL_ID } from "../../contracts/models.js";
import type { StudioGatewayConfig } from "./config.js";
import type {
  StudioChatMessage,
  StudioChatRequest,
  StudioChatToolDefinition,
} from "./client.js";

/**
 * Resolves the Pi model id to a gateway model id. The stable default alias is
 * the only id the harness rewrites; it can arrive either as the bare model
 * name (`default`) or as the fully qualified id (`project-studio/default`)
 * depending on how Pi hydrated the model. Every other id is a gateway catalog
 * id and is passed through unchanged.
 */
export function gatewayModelIdFor(
  modelId: string,
  config: StudioGatewayConfig,
): string {
  return modelId === DEFAULT_MODEL_NAME || modelId === STUDIO_MODEL_ID
    ? config.defaultModel
    : modelId;
}

function textOf(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function userContent(content: Message["content"]): unknown {
  if (typeof content === "string") return content;

  return content
    .map((part) => {
      if (part.type === "text") return { type: "text", text: part.text };
      if (part.type === "image") {
        return { type: "image", image: part.data, mediaType: part.mimeType };
      }
      return undefined;
    })
    .filter((part) => part !== undefined);
}

/**
 * Maps Pi's canonical transcript onto the gateway chat contract.
 *
 * Assistant tool calls are replayed with their original ids and order, and
 * each tool result names the call it answers, so a multi-turn tool exchange
 * survives the round trip. Thinking blocks are not replayed: the gateway
 * contract has no field for them and inventing one would change what the
 * provider sees.
 */
export function toStudioChatMessages(context: Context): StudioChatMessage[] {
  const messages: StudioChatMessage[] = [];

  if (context.systemPrompt) {
    messages.push({ role: "system", content: context.systemPrompt });
  }

  for (const message of context.messages) {
    if (message.role === "user") {
      messages.push({ role: "user", content: userContent(message.content) });
      continue;
    }

    if (message.role === "toolResult") {
      messages.push({
        role: "tool",
        content: textOf(message.content),
        toolCallId: message.toolCallId,
        toolName: message.toolName,
      });
      continue;
    }

    const toolCalls = message.content.filter((part) => part.type === "toolCall");
    messages.push({
      role: "assistant",
      content: textOf(message.content),
      ...(toolCalls.length === 0
        ? {}
        : {
            toolCalls: toolCalls.map((call) => ({
              id: call.id,
              name: call.name,
              arguments: JSON.stringify(call.arguments ?? {}),
            })),
          }),
    });
  }

  return messages;
}

export function toStudioChatTools(
  context: Context,
): StudioChatToolDefinition[] | undefined {
  if (!context.tools?.length) return undefined;

  return context.tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as Record<string, unknown>,
    },
  }));
}

export function toStudioChatRequest(
  model: Model<Api>,
  context: Context,
  config: StudioGatewayConfig,
  options?: SimpleStreamOptions,
): StudioChatRequest {
  const tools = toStudioChatTools(context);

  return {
    model: gatewayModelIdFor(model.id, config),
    messages: toStudioChatMessages(context),
    stream: true,
    ...(options?.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options?.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(tools === undefined ? {} : { tools }),
    ...(options?.reasoning === undefined ? {} : { reasoningEffort: options.reasoning }),
  };
}
