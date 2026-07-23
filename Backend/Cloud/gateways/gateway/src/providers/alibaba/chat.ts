import { generateText, streamText } from "ai";
import { toAiMessages, toAiToolChoice, toAiTools, toStructuredOutput } from "@/platform/aiSdk/chatRequest";
import { createChatResponse } from "@/platform/aiSdk/chatResponse";
import { createAiSdkGatewayStreamResponse } from "@/platform/aiSdk/streamResponse";
import type { ChatRequest, ChatResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { mapProviderError } from "@/platform/errors";
import { createAlibabaClient } from "./client";

export async function alibabaChat(request: ChatRequest, context: HandlerContext): Promise<ChatResponse | Response> {
  try {
    const provider = createAlibabaClient(context);
    const model = provider.chatModel(request.model);
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
        alibaba: toAlibabaProviderOptions(request)
      }
    };

    if (request.stream) {
      const result = streamText(call as never);
      return createAiSdkGatewayStreamResponse(result as never, { provider: "alibaba", model: request.model });
    }

    const result = await generateText(call as never);
    return createChatResponse("alibaba", request.model, result);
  } catch (error) {
    throw mapProviderError(error);
  }
}

// Minimal provider options (keyed by the provider `name` "alibaba"). Reasoning is deliberately
// not mapped yet (DashScope uses `enable_thinking`, not OpenAI reasoning_effort).
function toAlibabaProviderOptions(request: ChatRequest): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (request.user) {
    options.user = request.user;
  }
  return options;
}
