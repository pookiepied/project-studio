import { generateText, streamText } from "ai";
import { toAiMessages, toAiToolChoice, toAiTools, toStructuredOutput } from "@/platform/aiSdk/chatRequest";
import { createChatResponse } from "@/platform/aiSdk/chatResponse";
import { createAiSdkGatewayStreamResponse } from "@/platform/aiSdk/streamResponse";
import type { ChatRequest, ChatResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { mapProviderError } from "@/platform/errors";
import { createOpenAIClient } from "./client";

export async function openaiChat(request: ChatRequest, context: HandlerContext): Promise<ChatResponse | Response> {
  try {
    const provider = createOpenAIClient(context);
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
        openai: {
          store: false,
          reasoningEffort: request.reasoningEffort,
          user: request.user,
          previousResponseId: request.previousResponseId,
          promptCacheKey: request.promptCacheKey,
          strictJsonSchema: request.responseFormat?.type === "json_schema" ? true : undefined
        }
      }
    };

    if (request.stream) {
      const result = streamText(call as never);
      return createAiSdkGatewayStreamResponse(result as never, { provider: "openai", model: request.model });
    }

    const result = await generateText(call as never);
    return createChatResponse("openai", request.model, result);
  } catch (error) {
    throw mapProviderError(error);
  }
}
