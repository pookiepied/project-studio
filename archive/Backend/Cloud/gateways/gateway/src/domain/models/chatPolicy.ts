import type { ChatRequest } from "@/domain/contracts";
import { GatewayError } from "@/platform/errors";
import { Capability, type ModelInfo } from "./capabilities";

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

function containsImageInput(request: ChatRequest): boolean {
  return request.messages.some((message) => {
    if (!Array.isArray(message.content)) return false;
    return message.content.some((part) => part.type === "image");
  });
}
