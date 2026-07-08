import type { GatewayEnv }                     from "../env";
import { createProvider, getApiKey }             from "../providers";
import type { CapturedUsage, CompletionParams }  from "../providers/types";
import { recordUsage }                           from "../tracking/usage";

export async function handleChatCompletions(
  request: Request,
  env:     GatewayEnv,
  ctx?:    ExecutionContext,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json(
      { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
      { status: 400 },
    );
  }

  const rawModel = (body.model as string) ?? "";
  if (!rawModel) {
    return Response.json(
      { error: { message: "Missing required field: model", type: "invalid_request_error" } },
      { status: 400 },
    );
  }

  const requestStart = Date.now();
  const userId       = request.headers.get("x-user-id") ?? undefined;
  // x-internal:1 allows callers to opt out of usage recording (e.g. internal tooling).
  // Chat no longer sets this — gateway is now the authoritative recorder for LLM calls.
  const isInternal   = request.headers.get("x-internal") === "1";

  const colonIdx = rawModel.indexOf(":");
  const provider = colonIdx === -1 ? "groq" : rawModel.slice(0, colonIdx);
  const modelId  = colonIdx === -1 ? rawModel : rawModel.slice(colonIdx + 1);

  // x-provider-api-key: caller's own key (BYOK) overrides gateway's env key.
  // Tracked with source:"byok" so usage can be attributed separately.
  const callerKey = request.headers.get("x-provider-api-key") ?? undefined;
  const apiKey    = callerKey ?? getApiKey(env, provider) ?? "";
  if (!apiKey) {
    return Response.json(
      { error: { message: `No API key configured for provider '${provider}'. Set ${provider.toUpperCase()}_API_KEY.`, type: "auth_error" } },
      { status: 401 },
    );
  }

  const adapter = createProvider(provider, apiKey, undefined, env);

  // Map effort-level strings to token budgets so callers can pass "low"/"medium"/"high".
  function resolveReasoningBudget(raw: unknown): number | undefined {
    if (typeof raw === "number") return raw;
    if (raw === "low")    return 4_096;
    if (raw === "medium") return 8_192;
    if (raw === "high")   return 16_384;
    return undefined;
  }

  const params: CompletionParams = {
    model:           modelId,
    messages:        (body.messages as CompletionParams["messages"]) ?? [],
    temperature:     (body.temperature as number) ?? 0.5,
    maxTokens:       body.max_tokens as number | undefined,
    topP:            body.top_p as number | undefined,
    tools:           body.tools as unknown[] | undefined,
    toolChoice:      body.tool_choice as CompletionParams["toolChoice"] | undefined,
    reasoningBudget: resolveReasoningBudget(body.reasoning_budget),
    abortSignal:     request.signal,
  };

  if (body.stream === true) {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer  = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      let streamUsage: CapturedUsage | null = null;
      try {
        for await (const event of adapter.streamFull(params)) {
          if (event.type === "usage") streamUsage = event.data as CapturedUsage;
          await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        await writer.write(encoder.encode("data: [DONE]\n\n"));
        if (!isInternal) recordUsage({ env, ctx, userId, provider, model: rawModel, capturedUsage: streamUsage, requestStart, source: callerKey ? "byok" : undefined });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isInternal) recordUsage({ env, ctx, userId, provider, model: rawModel, capturedUsage: streamUsage, requestStart, status: "error", source: callerKey ? "byok" : undefined });
        // Guard: the write may fail if the client already disconnected
        try {
          await writer.write(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`),
          );
          await writer.write(encoder.encode("data: [DONE]\n\n"));
        } catch {
          // Client gone — nothing more to do
        }
      } finally {
        writer.close().catch(() => {});
      }
    })();

    return new Response(readable, {
      headers: {
        "Content-Type":       "text/event-stream",
        "Cache-Control":      "no-cache, no-store",
        "X-Accel-Buffering":  "no",
        "X-Gateway-Provider": provider,
      },
    });
  }

  // Non-streaming — return OpenAI-compatible JSON.
  let capturedUsage: CapturedUsage | null = null;
  let message: Awaited<ReturnType<typeof adapter.complete>>;
  try {
    message = await adapter.complete({
      ...params,
      captureUsage: (u) => { capturedUsage = u; },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isInternal) recordUsage({ env, ctx, userId, provider, model: rawModel, capturedUsage: null, requestStart, status: "error", source: callerKey ? "byok" : undefined });
    return Response.json(
      { error: { message: msg, type: "provider_error" } },
      { status: 502 },
    );
  }
  if (!isInternal) recordUsage({ env, ctx, userId, provider, model: rawModel, capturedUsage, requestStart, source: callerKey ? "byok" : undefined });

  return Response.json({
    id:      `chatcmpl-${crypto.randomUUID()}`,
    object:  "chat.completion",
    model:   rawModel,
    choices: [{
      index:        0,
      message: {
        role:       "assistant",
        content:    typeof message.content === "string" ? message.content : null,
        tool_calls: message.tool_calls?.length ? message.tool_calls : undefined,
      },
      finish_reason: message.tool_calls?.length ? "tool_calls" : "stop",
    }],
    ...(capturedUsage ? { usage: capturedUsage } : {}),
  });
}
