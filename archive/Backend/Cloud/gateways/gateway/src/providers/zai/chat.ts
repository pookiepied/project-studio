import { generateText, streamText } from "ai";
import { toAiMessages, toAiToolChoice, toAiTools, toStructuredOutput } from "@/platform/aiSdk/chatRequest";
import { createChatResponse } from "@/platform/aiSdk/chatResponse";
import { createAiSdkGatewayStreamResponse } from "@/platform/aiSdk/streamResponse";
import type { ChatRequest, ChatResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { mapProviderError } from "@/platform/errors";
import { createZaiClient } from "./client";
import type { ReasoningEffort } from "@/domain/models/capabilities";

export async function zaiChat(request: ChatRequest, context: HandlerContext): Promise<ChatResponse | Response> {
  try {
    const provider = createZaiClient(context);
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
        zai: toZaiProviderOptions(request)
      }
    };

    if (request.stream) {
      const result = streamText(call as never);
      return createAiSdkGatewayStreamResponse(result as never, { provider: "zai", model: request.model });
    }

    const result = await generateText(call as never);
    return createChatResponse("zai", request.model, result);
  } catch (error) {
    throw mapProviderError(error);
  }
}

// Maps gateway request fields onto @ai-sdk/openai-compatible provider options (keyed by the
// provider `name` "zai"). `reasoningEffort` is serialized to the `reasoning_effort` body
// field, which GLM-5.x's reasoning-capable models accept natively (low/medium/high - the same
// scale as OpenAI). Validation has already confirmed the model supports the requested effort
// (per-model ReasoningFeatures) before we reach here, so we only omit it for `none`.
function toZaiProviderOptions(request: ChatRequest): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (request.user) {
    options.user = request.user;
  }
  const effort = request.reasoningEffort;
  if (effort && effort !== "none") {
    options.reasoningEffort = mapEffort(effort);
  }
  return options;
}

// GLM's reasoning_effort accepts "low" | "medium" | "high". The gateway scale is wider;
// collapse the extremes (there is no distinct "minimal"/"xhigh" documented for GLM).
function mapEffort(effort: ReasoningEffort): "low" | "medium" | "high" {
  switch (effort) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
      return "high";
    default:
      return "medium";
  }
}
