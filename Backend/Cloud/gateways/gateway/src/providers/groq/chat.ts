import { generateText, streamText } from "ai";
import { toAiMessages, toAiToolChoice, toAiTools, toStructuredOutput } from "@/platform/aiSdk/chatRequest";
import { createChatResponse } from "@/platform/aiSdk/chatResponse";
import { createAiSdkGatewayStreamResponse } from "@/platform/aiSdk/streamResponse";
import type { ChatRequest, ChatResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { mapProviderError } from "@/platform/errors";
import { createGroqClient } from "./client";

export async function groqChat(request: ChatRequest, context: HandlerContext): Promise<ChatResponse | Response> {
  try {
    const provider = createGroqClient(context);
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
        groq: toGroqProviderOptions(request)
      }
    };

    if (request.stream) {
      const result = streamText(call as never);
      return createAiSdkGatewayStreamResponse(result as never, { provider: "groq", model: request.model });
    }

    const result = await generateText(call as never);
    return createChatResponse("groq", request.model, result);
  } catch (error) {
    throw mapProviderError(error);
  }
}

// Builds the @ai-sdk/groq provider options, gating each quirk per model:
//   - gpt-oss-120b: NO parallel tool calls (Groq docs) -> parallelToolCalls=false.
//   - Reasoning effort: GPT-OSS accepts low|medium|high directly; Qwen3 reasoning is on/off,
//     so any gateway effort other than "none" collapses to Groq's "default". Validation has
//     already confirmed the model supports the requested effort before we reach here.
function toGroqProviderOptions(request: ChatRequest): Record<string, unknown> {
  const modelId = request.model;
  const options: Record<string, unknown> = {
    user: request.user,
    strictJsonSchema: request.responseFormat?.type === "json_schema" ? true : undefined
  };

  if (/gpt-oss-120b/i.test(modelId)) {
    options.parallelToolCalls = false;
  }

  const effort = request.reasoningEffort;
  if (effort) {
    if (/gpt-oss/i.test(modelId)) {
      // GPT-OSS uses reasoning_effort low|medium|high; drop none/minimal it cannot express.
      if (effort === "low" || effort === "medium" || effort === "high") {
        options.reasoningEffort = effort;
      }
    } else {
      // Qwen3 / QwQ / DeepSeek-R1: on/off reasoning. Separate reasoning from content.
      options.reasoningEffort = effort === "none" ? "none" : "default";
      options.reasoningFormat = "parsed";
    }
  }

  return options;
}
