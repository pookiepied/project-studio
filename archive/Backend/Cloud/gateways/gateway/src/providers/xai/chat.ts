import { generateText, streamText } from "ai";
import { toAiMessages, toAiToolChoice, toAiTools, toStructuredOutput } from "@/platform/aiSdk/chatRequest";
import { createChatResponse } from "@/platform/aiSdk/chatResponse";
import { createAiSdkGatewayStreamResponse } from "@/platform/aiSdk/streamResponse";
import type { ChatRequest, ChatResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { mapProviderError } from "@/platform/errors";
import { createXaiClient } from "./client";

export async function xaiChat(request: ChatRequest, context: HandlerContext): Promise<ChatResponse | Response> {
  try {
    const provider = createXaiClient(context);
    // xAI is OpenAI-wire-compatible. provider.chat() pins the Chat Completions API
    // (OpenAI wire shape) - the same path @ai-sdk/xai v3 exposes for function tools and
    // the `reasoningEffort` provider option. The default callable / .responses() route to
    // the xAI Responses API, whose server-side agentic tools are not a normalized gateway
    // modality (see ./capabilities.ts).
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
        xai: {
          // Validation has already confirmed the model supports the requested effort and
          // value (reasoning-capable Grok variants only; efforts are a subset of
          // none|low|medium|high that the @ai-sdk/xai chat-options schema accepts).
          reasoningEffort: request.reasoningEffort
        }
      }
    };

    if (request.stream) {
      const result = streamText(call as never);
      return createAiSdkGatewayStreamResponse(result as never, { provider: "xai", model: request.model });
    }

    const result = await generateText(call as never);
    return createChatResponse("xai", request.model, result);
  } catch (error) {
    throw mapProviderError(error);
  }
}
