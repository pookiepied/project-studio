import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, streamText } from "ai";
import type { ChatRequest } from "../contract.ts";
import { buildProviderOptionsForReasoning, normalizeMessagesForSDK, openAIToolsToAISDKTools, resolveReasoning } from "../shared/runtime.ts";
import { mapFinishReason } from "../shared/normalization.ts";
import { aiSdkStreamToResponse, stableCompletionId } from "../shared/sse.ts";

export function createGoogleRuntime(apiKey: string, baseUrl?: string) {
  return createGoogleGenerativeAI({ apiKey, baseURL: baseUrl || undefined });
}

export async function googleChat(req: ChatRequest): Promise<Response> {
  const { body, apiKey, provider, signal } = req;
  const google = createGoogleRuntime(apiKey, provider.baseUrl);
  const reasoningOpt = resolveReasoning(req.reasoning);
  const providerOptions = buildProviderOptionsForReasoning("google", req.reasoning, body as Record<string, unknown>);
  const messages = normalizeMessagesForSDK(body.messages as never) as never;
  const tools = openAIToolsToAISDKTools(body.tools as never);
  const model = google(req.model.id);
  const isStream = body.stream === true;

  if (!isStream) {
    const result = await (generateText as any)({
      model,
      messages: messages as never,
      tools: tools as never,
      abortSignal: signal,
      ...(reasoningOpt.reasoning ? { reasoning: reasoningOpt.reasoning as never } : {}),
      ...(providerOptions ? { providerOptions } : {}),
    });
    const text = result.text ?? "";
    const finish = mapFinishReason(result.finishReason);
    const usage = result.usage ? { prompt_tokens: result.usage.inputTokens ?? 0, completion_tokens: result.usage.outputTokens ?? 0, total_tokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0) } : undefined;
    const payload = {
      id: stableCompletionId(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: req.model.id,
      choices: [{ index: 0, message: { role: "assistant", content: text, ...(result.reasoningText ? { reasoning_content: result.reasoningText } : {}) }, finish_reason: finish }],
      ...(usage ? { usage } : {}),
    };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }

  const result = (streamText as any)({
    model,
    messages: messages as never,
    tools: tools as never,
    abortSignal: signal,
    ...(reasoningOpt.reasoning ? { reasoning: reasoningOpt.reasoning as never } : {}),
    ...(providerOptions ? { providerOptions } : {}),
  });

  return aiSdkStreamToResponse(result.fullStream, req.model.id, req.signal);
}
