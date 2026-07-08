import { Capability, type ModelInfo } from "./capabilities";
import { GatewayError } from "./errors";
import type { ChatRequest } from "./types";

export function assertChatRequestAllowed(request: ChatRequest, model: ModelInfo): void {
  if (!model.capabilities.modalities.includes(Capability.Chat) || !model.capabilities.chat) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Model ${model.id} does not support chat.`);
  }

  const chat = model.capabilities.chat;
  if (request.stream && !chat.streaming) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Model ${model.id} does not support streaming chat.`);
  }
  if (containsImageInput(request) && !chat.vision) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Model ${model.id} does not accept image input.`);
  }
  if (request.tools?.length && !chat.tools) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Model ${model.id} does not support tools.`);
  }
  if (request.reasoningEffort && !chat.reasoning.supported) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Model ${model.id} does not support reasoning controls.`);
  }
  if (request.reasoningEffort && !chat.reasoning.efforts.includes(request.reasoningEffort)) {
    throw new GatewayError(
      "CAPABILITY_NOT_SUPPORTED",
      `Model ${model.id} does not support reasoning effort "${request.reasoningEffort}".`
    );
  }
  if (request.responseFormat?.type === "json_schema" && !chat.jsonSchema) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Model ${model.id} does not support JSON schema output.`);
  }
}

export function assertValidChatBody(body: unknown): asserts body is ChatRequest {
  if (!body || typeof body !== "object") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must be a JSON object.");
  }

  const candidate = body as Partial<ChatRequest>;
  if (!candidate.model || typeof candidate.model !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include a model string.");
  }
  if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include at least one message.");
  }
}

export function normalizeChatRequest(body: ChatRequest): ChatRequest {
  const reasoningEffort =
    body.reasoningEffort ??
    body.reasoning_effort ??
    reasoningBudgetToEffort(body.reasoningBudget ?? body.reasoning_budget);

  return {
    ...body,
    topP: body.topP ?? body.top_p,
    maxTokens: body.maxTokens ?? body.max_tokens,
    toolChoice: body.toolChoice ?? body.tool_choice,
    responseFormat: body.responseFormat ?? body.response_format,
    reasoningEffort,
    reasoningBudget: body.reasoningBudget ?? body.reasoning_budget,
    previousResponseId: body.previousResponseId ?? body.previous_response_id,
    promptCacheKey: body.promptCacheKey ?? body.prompt_cache_key
  };
}

export function containsImageInput(request: ChatRequest): boolean {
  return request.messages.some((message) => {
    if (!Array.isArray(message.content)) return false;
    return message.content.some((part) => part.type === "image");
  });
}

function reasoningBudgetToEffort(budget: number | undefined): ChatRequest["reasoningEffort"] {
  if (budget == null) return undefined;
  if (budget <= 0) return "none";
  if (budget <= 4096) return "low";
  if (budget <= 8192) return "medium";
  return "high";
}
