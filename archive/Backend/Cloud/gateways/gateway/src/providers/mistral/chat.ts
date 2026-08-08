import { generateText, streamText } from "ai";
import { toAiMessages, toAiToolChoice, toAiTools, toStructuredOutput } from "@/platform/aiSdk/chatRequest";
import { createChatResponse } from "@/platform/aiSdk/chatResponse";
import { createAiSdkGatewayStreamResponse } from "@/platform/aiSdk/streamResponse";
import type { ChatRequest, ChatResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { mapProviderError } from "@/platform/errors";
import { createMistralClient } from "./client";
import type { ReasoningEffort } from "@/domain/models/capabilities";

export async function mistralChat(request: ChatRequest, context: HandlerContext): Promise<ChatResponse | Response> {
  try {
    const provider = createMistralClient(context);
    const model = provider.chat(request.model as never);
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
        mistral: toMistralProviderOptions(request)
      }
    };

    if (request.stream) {
      const result = streamText(call as never);
      return createAiSdkGatewayStreamResponse(result as never, { provider: "mistral", model: request.model });
    }

    const result = await generateText(call as never);
    return createChatResponse("mistral", request.model, result);
  } catch (error) {
    throw mapProviderError(error);
  }
}

// Builds @ai-sdk/mistral provider options. Mistral's only reasoning control is a binary
// reasoningEffort of 'none' | 'high' (Magistral models). The gateway ReasoningEffort scale
// collapses onto it: 'none' -> 'none' (reasoning off), anything else -> 'high'. Validation has
// already confirmed the model exposes the requested effort (Magistral efforts = none|high).
function toMistralProviderOptions(request: ChatRequest): Record<string, unknown> {
  const options: Record<string, unknown> = {};

  const effort = request.reasoningEffort;
  if (effort) {
    options.reasoningEffort = mapEffort(effort);
  }

  return options;
}

function mapEffort(effort: ReasoningEffort): "none" | "high" {
  return effort === "none" ? "none" : "high";
}
