import { generateText, streamText } from "ai";
import { normalizeImageInput, toAiToolChoice, toAiTools } from "@/platform/aiSdk/chatRequest";
import { createChatResponse } from "@/platform/aiSdk/chatResponse";
import { mapProviderError } from "@/platform/errors";
import { createAiSdkGatewayStreamResponse } from "@/platform/aiSdk/streamResponse";
import type { ReasoningEffort } from "@/domain/models/capabilities";
import type { ChatRequest, ChatResponse } from "@/domain/contracts";
import type { HandlerContext } from "@/providers/types";
import { createAnthropicClient } from "./client";

export async function anthropicChat(request: ChatRequest, context: HandlerContext): Promise<ChatResponse | Response> {
  try {
    const provider = createAnthropicClient(context);
    const call = {
      model: provider(request.model as never),
      messages: toAiMessages(request),
      temperature: request.temperature,
      topP: request.topP,
      maxOutputTokens: request.maxTokens,
      tools: toAiTools(request),
      toolChoice: toAiToolChoice(request.toolChoice),
      abortSignal: context.request.signal,
      providerOptions: {
        anthropic: anthropicReasoningOptions(request)
      }
    };

    if (request.stream) {
      const result = streamText(call as never);
      return createAiSdkGatewayStreamResponse(result as never, { provider: "anthropic", model: request.model });
    }

    const result = await generateText(call as never);
    return createChatResponse("anthropic", request.model, result);
  } catch (error) {
    throw mapProviderError(error);
  }
}

function toAiMessages(request: ChatRequest) {
  // A single ephemeral cache_control breakpoint is placed on the final message when the
  // caller opts into prompt caching (via promptCacheKey). Anthropic caches by prefix
  // match, so this caches everything up to and including the last turn. Validation has
  // already confirmed the model supports prompt caching before we reach here.
  const cachingEnabled = Boolean(request.promptCacheKey);
  const lastIndex = request.messages.length - 1;

  return request.messages.map((message, index) => {
    const content = Array.isArray(message.content)
      ? message.content.map((part) => {
          if (part.type === "image") {
            const normalized = normalizeImageInput(part.image, part.mediaType);
            return {
              type: "image",
              image: normalized.image,
              mediaType: normalized.mediaType
            };
          }
          return part;
        })
      : message.content;

    return {
      role: message.role,
      content,
      name: message.name,
      toolCallId: message.toolCallId,
      ...(cachingEnabled && index === lastIndex
        ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
        : {})
    };
  });
}

// Anthropic has two distinct reasoning mechanisms depending on the model, so the gateway
// passes each model exactly what its official API supports:
//
//  1. Adaptive thinking + `effort` (the modern lineup: Opus 4.6+/4.7/4.8, Sonnet 4.6/5,
//     Fable 5, ...). Thinking depth is controlled by an `effort` level (low|medium|high|xhigh|
//     max), and thinking is requested with `thinking: { type: "adaptive" }`. Manual
//     `budget_tokens` returns HTTP 400 on these models.
//     Ref: https://platform.claude.com/docs/en/build-with-claude/effort
//  2. Manual thinking + `budget_tokens` (older lineup that is NOT effort-supported, e.g.
//     Claude Haiku 4.5, Opus 4.5). Thinking depth is a token budget via
//     `thinking: { type: "enabled", budgetTokens: N }`.
//
// Default = adaptive/effort: every current and future Claude model uses effort, so only the
// known legacy budget models are listed below. A model missing from the set therefore gets the
// future-proof effort path automatically.
const ANTHROPIC_MANUAL_THINKING_MODELS = new Set<string>([
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-5",
  "claude-opus-4-5-20251101"
]);

function usesManualThinking(model: string): boolean {
  return ANTHROPIC_MANUAL_THINKING_MODELS.has(model);
}

// Manual-thinking budget per effort tier (used only for legacy budget_tokens models).
const REASONING_BUDGET_TOKENS: Record<Exclude<ReasoningEffort, "none">, number> = {
  minimal: 1024,
  low: 4000,
  medium: 8000,
  high: 16000,
  xhigh: 24000
};

// Gateway effort scale (none|minimal|low|medium|high|xhigh) -> Anthropic effort scale
// (low|medium|high|xhigh|max). Anthropic has no "minimal"; validation already rejects efforts a
// model doesn't declare, so "minimal" only reaches here defensively -> mapped to "low".
function toAnthropicEffort(effort: Exclude<ReasoningEffort, "none">): "low" | "medium" | "high" | "xhigh" {
  switch (effort) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
      return "xhigh";
  }
}

// Builds the `providerOptions.anthropic` reasoning fields for the resolved model.
function anthropicReasoningOptions(request: ChatRequest): Record<string, unknown> {
  const effort = request.reasoningEffort;

  if (usesManualThinking(request.model)) {
    // Legacy budget_tokens models. `none`/omitted -> omit thinking (model does not think).
    if (!effort || effort === "none") return {};
    return { thinking: { type: "enabled", budgetTokens: request.reasoningBudget ?? REASONING_BUDGET_TOKENS[effort] } };
  }

  // Modern adaptive/effort models. `none`/omitted -> omit thinking + effort so the model runs
  // at its default (Opus 4.8 without thinking; Sonnet 5 / Fable 5 keep their always-on adaptive
  // default, which cannot be disabled). Otherwise request adaptive thinking at the mapped effort.
  if (!effort || effort === "none") return {};
  return { effort: toAnthropicEffort(effort), thinking: { type: "adaptive" } };
}
