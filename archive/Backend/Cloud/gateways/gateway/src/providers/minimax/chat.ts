import { generateText, streamText } from "ai";
import { toAiMessages, toAiToolChoice, toAiTools, toStructuredOutput } from "@/platform/aiSdk/chatRequest";
import { createChatResponse } from "@/platform/aiSdk/chatResponse";
import { createAiSdkGatewayStreamResponse } from "@/platform/aiSdk/streamResponse";
import type { ChatRequest, ChatResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { mapProviderError } from "@/platform/errors";
import { createMinimaxClient } from "./client";

export async function minimaxChat(request: ChatRequest, context: HandlerContext): Promise<ChatResponse | Response> {
  try {
    const provider = createMinimaxClient(context);
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
        minimax: toMinimaxProviderOptions(request)
      }
    };

    if (request.stream) {
      const result = streamText(call as never);
      return createAiSdkGatewayStreamResponse(result as never, { provider: "minimax", model: request.model });
    }

    const result = await generateText(call as never);
    return createChatResponse("minimax", request.model, result);
  } catch (error) {
    throw mapProviderError(error);
  }
}

// Minimal provider options (keyed by the provider `name` "minimax"). Reasoning is deliberately
// not mapped yet (MiniMax-M3 uses a boolean `thinking` / `reasoning_split` toggle, not OpenAI
// reasoning_effort).
function toMinimaxProviderOptions(request: ChatRequest): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (request.user) {
    options.user = request.user;
  }
  return options;
}
