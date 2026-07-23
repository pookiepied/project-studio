import { generateText, streamText } from "ai";
import { toAiMessages, toAiToolChoice, toAiTools, toStructuredOutput } from "@/platform/aiSdk/chatRequest";
import { createChatResponse } from "@/platform/aiSdk/chatResponse";
import { mapProviderError } from "@/platform/errors";
import { createAiSdkGatewayStreamResponse } from "@/platform/aiSdk/streamResponse";
import type { ChatRequest, ChatResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { createGoogleClient } from "./client";

export async function googleChat(request: ChatRequest, context: HandlerContext): Promise<ChatResponse | Response> {
  try {
    const provider = createGoogleClient(context);
    const call = {
      model: provider(request.model as never),
      messages: toAiMessages(request),
      temperature: request.temperature,
      topP: request.topP,
      maxOutputTokens: request.maxTokens,
      tools: toAiTools(request),
      toolChoice: toAiToolChoice(request.toolChoice),
      experimental_output: toStructuredOutput(request),
      abortSignal: context.request.signal,
      providerOptions: {
        google: {
          structuredOutputs: request.responseFormat?.type === "json_schema" ? true : undefined,
          thinkingConfig: toGoogleThinkingConfig(request),
          responseModalities: ["TEXT"]
        }
      }
    };

    if (request.stream) {
      const result = streamText(call as never);
      return createAiSdkGatewayStreamResponse(result as never, { provider: "google", model: request.model });
    }

    const result = await generateText(call as never);
    return createChatResponse("google", request.model, result);
  } catch (error) {
    throw mapProviderError(error);
  }
}

function toGoogleThinkingConfig(request: ChatRequest) {
  if (!request.reasoningEffort) return undefined;
  if (request.reasoningEffort === "none") {
    return { thinkingBudget: 0 };
  }
  const thinkingLevel = request.reasoningEffort === "xhigh" ? "high" : request.reasoningEffort;
  return {
    thinkingLevel,
    includeThoughts: true
  };
}

