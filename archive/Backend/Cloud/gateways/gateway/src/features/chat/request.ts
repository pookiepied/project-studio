import { GatewayError } from "@/platform/errors";
import type { ChatRequest } from "@/domain/contracts";

export function assertValidChatBody(body: unknown): asserts body is ChatRequest {
  if (!body || typeof body !== "object") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must be a JSON object.");
  }

  const candidate = body as Partial<ChatRequest>;
  if (!candidate.model || typeof candidate.model !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include a model string.");
  }
  if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include at least one message.");
  }
}

export function normalizeChatRequest(body: ChatRequest): ChatRequest {
  const reasoningEffort =
    body.reasoningEffort ??
    body.reasoning_effort ??
    reasoningBudgetToEffort(body.reasoningBudget ?? body.reasoning_budget);

  return {
    ...body,
    topP: body.topP ?? body.top_p,
    maxTokens: body.maxTokens ?? body.max_tokens,
    toolChoice: body.toolChoice ?? body.tool_choice,
    responseFormat: body.responseFormat ?? body.response_format,
    reasoningEffort,
    reasoningBudget: body.reasoningBudget ?? body.reasoning_budget,
    previousResponseId: body.previousResponseId ?? body.previous_response_id,
    promptCacheKey: body.promptCacheKey ?? body.prompt_cache_key
  };
}

function reasoningBudgetToEffort(budget: number | undefined): ChatRequest["reasoningEffort"] {
  if (budget == null) return undefined;
  if (budget <= 0) return "none";
  if (budget <= 4096) return "low";
  if (budget <= 8192) return "medium";
  return "high";
}
