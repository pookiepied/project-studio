// These are the installed Flue event/message and provider stream vocabularies.
// They are a projection, not a claim to capture arbitrary vendor-specific maps.
export const RUNTIME_CONTENT_FIELDS = [
  "v", "type", "eventIndex", "timestamp", "instanceId", "submissionId", "conversationId", "agentName",
  "operationId", "operationKind", "turnId", "taskId", "toolCallId", "toolName", "purpose", "origin",
  "agentInput", "agentOutput", "description", "args", "effectiveResult", "errorInfo", "request", "response",
  "input", "output", "result", "error", "name", "message", "stack", "cause", "code", "domain", "kind",
  "retryable", "details", "dev", "meta", "role", "content", "text", "thinking", "reasoning", "delta",
  "messages", "toolResults", "tools", "toolCalls", "toolCall", "arguments", "id", "title", "summary",
  "systemPrompt", "providerId", "providerName", "requestedModel", "api", "reasoningLevel", "maxTokens",
  "temperature", "contextCompacted", "responseId", "responseModel", "finishReason", "providerFinishReason",
  "gatewayLogId", "usage", "cost", "total", "totalTokens", "cacheRead", "cacheWrite", "isError", "durationMs",
  "contentIndex", "agent", "prompt", "cwd", "reason", "estimatedTokens", "messagesBefore", "messagesAfter",
  "level", "attributes", "outcome", "attemptCount", "maxAttempts", "operation", "mimeType", "data", "uri",
] as const;

export const PROVIDER_CONTENT_FIELDS = [
  ...RUNTIME_CONTENT_FIELDS,
  "model", "choices", "index", "finish_reason", "logprobs", "tool_calls", "function", "refusal", "status",
  "output_text", "input_tokens", "output_tokens", "prompt_tokens", "completion_tokens", "total_tokens",
  "input_tokens_details", "output_tokens_details", "cached_tokens", "reasoning_tokens", "completion_tokens_details",
  "prompt_tokens_details", "cache_creation_input_tokens", "cache_read_input_tokens", "stop_reason", "stop_sequence",
  "content_block", "content_block_start", "signature", "response_id", "item_id", "call_id", "item", "part",
  "content_index", "output_index", "candidates", "parts", "functionCall", "functionResponse", "usageMetadata",
  "promptTokenCount", "candidatesTokenCount", "cachedContentTokenCount", "thoughtsTokenCount", "totalTokenCount",
  "finishReason", "system_fingerprint", "created", "object", "temperature", "top_p", "max_tokens", "stream",
  "partial_json", "partialJson", "partialArgs", "argumentTextDelta",
] as const;

export const ERROR_CONTENT_FIELDS = [
  "name", "message", "stack", "cause", "errors", "code", "domain", "kind", "retryable", "details",
  "operation", "reason", "status", "type", "dev", "meta",
] as const;

/** Compile schema-declared argument names at registration, never on user data. */
export function schemaContentFields(schema: unknown): readonly string[] {
  const fields = new Set<string>();
  const seen = new WeakSet<object>();
  let remaining = 2_000;
  function visit(node: unknown, depth: number): void {
    if (node === null || typeof node !== "object" || depth > 10 || --remaining < 0 || seen.has(node)) return;
    seen.add(node);
    const own = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(node, key);
      return descriptor && "value" in descriptor ? descriptor.value : undefined;
    };
    const properties = own("properties");
    if (properties !== null && typeof properties === "object") {
      for (const key of Object.keys(properties).slice(0, 100)) {
        if (key.length > 160) continue;
        fields.add(key);
        const descriptor = Object.getOwnPropertyDescriptor(properties, key);
        if (descriptor && "value" in descriptor) visit(descriptor.value, depth + 1);
      }
    }
    visit(own("items"), depth + 1);
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      const alternatives = own(key);
      if (Array.isArray(alternatives)) for (const child of alternatives.slice(0, 20)) visit(child, depth + 1);
    }
  }
  try { visit(schema, 0); } catch { /* Unsupported schemas still have ordinary execution evidence. */ }
  return [...fields].slice(0, 256);
}
