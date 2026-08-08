import { generateText, streamText } from "ai";
import { toAiMessages, toAiToolChoice, toAiTools, toStructuredOutput } from "@/platform/aiSdk/chatRequest";
import { createChatResponse } from "@/platform/aiSdk/chatResponse";
import { createAiSdkGatewayStreamResponse } from "@/platform/aiSdk/streamResponse";
import type { ChatRequest, ChatResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { mapProviderError } from "@/platform/errors";
import { createDeepSeekClient } from "./client";
import type { ReasoningEffort } from "@/domain/models/capabilities";

export async function deepseekChat(request: ChatRequest, context: HandlerContext): Promise<ChatResponse | Response> {
  try {
    const provider = createDeepSeekClient(context);
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
        deepseek: toDeepSeekProviderOptions(request)
      }
    };

    if (request.stream) {
      const result = streamText(call as never);
      return createAiSdkGatewayStreamResponse(result as never, { provider: "deepseek", model: request.model });
    }

    const result = await generateText(call as never);
    return createChatResponse("deepseek", request.model, result);
  } catch (error) {
    throw mapProviderError(error);
  }
}

// Builds the @ai-sdk/deepseek provider options, mapping the gateway ReasoningEffort
// scale onto DeepSeek's two reasoning controls:
//   - providerOptions.deepseek.thinking: { type: 'adaptive'|'enabled'|'disabled' }
//   - providerOptions.deepseek.reasoningEffort: 'low'|'medium'|'high'|'xhigh'|'max'
//
// Gateway scale -> DeepSeek mapping (validation has already confirmed the model supports
// the requested effort before we reach here):
//   - 'none'     -> thinking disabled, no reasoningEffort (disables reasoning entirely)
//   - 'minimal'  -> thinking enabled, reasoningEffort 'low' (DeepSeek has no 'minimal')
//   - 'low'|'medium'|'high'|'xhigh' -> pass through reasoningEffort, thinking enabled
//   - (the gateway 'max' value is not user-facing; if requested it maps to 'max')
function toDeepSeekProviderOptions(request: ChatRequest): Record<string, unknown> {
  const options: Record<string, unknown> = {};

  const effort = request.reasoningEffort;
  if (effort) {
    const mapped = mapEffort(effort);
    if (mapped.thinking) {
      options.thinking = mapped.thinking;
    }
    if (mapped.reasoningEffort) {
      options.reasoningEffort = mapped.reasoningEffort;
    }
  }

  return options;
}

function mapEffort(effort: ReasoningEffort): { thinking?: { type: "adaptive" | "enabled" | "disabled" }; reasoningEffort?: string } {
  switch (effort) {
    case "none":
      return { thinking: { type: "disabled" } };
    case "minimal":
      // DeepSeek has no 'minimal'; enable thinking + lowest reasoning_effort.
      return { thinking: { type: "enabled" }, reasoningEffort: "low" };
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return { thinking: { type: "enabled" }, reasoningEffort: effort };
    default:
      return { thinking: { type: "adaptive" } };
  }
}
