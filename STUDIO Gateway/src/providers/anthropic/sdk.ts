import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, streamText } from "ai";
import type { ChatRequest } from "../contract.ts";
import { buildProviderOptionsForReasoning, normalizeMessagesForSDK, openAIToolsToAISDKTools, resolveReasoning } from "../shared/runtime.ts";
import { mapFinishReason } from "../shared/normalization.ts";
import { aiSdkStreamToResponse, stableCompletionId } from "../shared/sse.ts";

export function createAnthropicRuntime(apiKey: string, baseUrl?: string) {
  return createAnthropic({ apiKey, baseURL: baseUrl?.replace(/\/v1\/?$/, "") || undefined });
}

export async function anthropicChat(req: ChatRequest): Promise<Response> {
  const { body, apiKey, provider, signal } = req;
  const anthropic = createAnthropicRuntime(apiKey, provider.baseUrl);
  const _reasoning = (req.reasoning ?? (body as { reasoning?: unknown }).reasoning) as never;
  const reasoningOpt = resolveReasoning(req.reasoning);
  const providerOptions = buildProviderOptionsForReasoning("anthropic", req.reasoning, body as Record<string, unknown>);
  const messages = normalizeMessagesForSDK(body.messages as never) as never;
  const tools = openAIToolsToAISDKTools(body.tools as never);

  const model = anthropic(req.model.id);
  const isStream = body.stream === true;

  if (!isStream) {
    const result = await (generateText as any)({
      model,
      messages: messages as never,
      tools: tools as never,
      abortSignal: signal,
      ...(reasoningOpt.reasoning ? { reasoning: reasoningOpt.reasoning as never } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      maxOutputTokens: (body.max_tokens as number) ?? (body.max_completion_tokens as number) ?? undefined,
      temperature: body.temperature as number | undefined,
      topP: body.top_p as number | undefined,
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
