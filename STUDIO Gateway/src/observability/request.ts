/**
 * Request telemetry persistence.
 *
 * This is deliberately a normalized operational record, not a transcript
 * store. It gives the UI stable request IDs and analytics dimensions without
 * retaining prompts, completions, credentials, or provider payloads.
 */

import type { Context } from "hono";

const TELEMETRY_KEY = "gatewayRequestTelemetry";

export interface RequestTelemetryState {
  requestId: string;
  startedAt: number;
  method: string;
  path: string;
  statusCode?: number;
  gatewayKeyId?: string;
  gatewayKeyName?: string;
  modelId?: string;
  stream?: boolean;
  reasoningUsed?: boolean;
  routingLatencyMs?: number;
  application?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface ModelTelemetryRow {
  provider_id: string;
  category: string;
  pricing_input: number | null;
  pricing_output: number | null;
  pricing_cache_read: number | null;
  pricing_cache_write: number | null;
}

interface UsageValues {
  generationId?: string;
  providerResponseId?: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  toolsCalled?: boolean;
}

export function startRequestTelemetry(c: Context<any>): RequestTelemetryState {
  const state: RequestTelemetryState = {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    method: c.req.method,
    path: c.req.path,
    application: c.req.header("x-gateway-application") ?? c.req.header("x-studio-application"),
  };
  c.set(TELEMETRY_KEY, state);
  c.header("X-Request-ID", state.requestId);
  return state;
}

export function getRequestTelemetry(c: Context<any>): RequestTelemetryState | undefined {
  return typeof c.get === "function" ? c.get(TELEMETRY_KEY) as RequestTelemetryState | undefined : undefined;
}

export function updateRequestTelemetry(c: Context<any>, patch: Partial<RequestTelemetryState>): void {
  const state = getRequestTelemetry(c);
  if (state) Object.assign(state, patch);
}

export function markRoutingComplete(c: Context<any>): void {
  const state = getRequestTelemetry(c);
  if (state) state.routingLatencyMs = Math.max(0, Date.now() - state.startedAt);
}

export async function finalizeRequestTelemetry(
  db: D1Database,
  state: RequestTelemetryState,
  response: Response,
  error?: unknown,
): Promise<void> {
  const completedAt = Date.now();
  const totalLatencyMs = Math.max(0, completedAt - state.startedAt);
  const usage = await readUsage(response);
  const model = state.modelId
    ? await db
        .prepare(
          "SELECT models.provider_id, models.category, models.pricing_input, models.pricing_output, " +
            "models.pricing_cache_read, models.pricing_cache_write FROM models WHERE models.model_id = ? " +
            "ORDER BY models.exposed DESC, models.enabled DESC LIMIT 1",
        )
        .bind(state.modelId)
        .first<ModelTelemetryRow>()
    : null;
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const cacheReadTokens = usage.cacheReadTokens ?? usage.cachedTokens;
  const totalTokens = usage.totalTokens ?? sumDefined(inputTokens, outputTokens);
  const cost = calculateCost(model, inputTokens, outputTokens, cacheReadTokens, usage.cacheWriteTokens);
  const routingLatencyMs = state.routingLatencyMs ?? 0;
  const providerLatencyMs = Math.max(0, totalLatencyMs - routingLatencyMs);
  const tokensPerSecond = outputTokens && providerLatencyMs > 0 ? outputTokens / (providerLatencyMs / 1000) : null;
  const statusCode = state.statusCode ?? response.status ?? (error ? 500 : 200);
  const errorMessage = error instanceof Error ? error.message : undefined;

  await db
    .prepare(
      `INSERT OR REPLACE INTO gateway_requests (
        request_id, generation_id, created_at, completed_at, method, path, status_code,
        gateway_key_id, gateway_key_name, user_id, application, model_id, provider_id,
        model_category, streaming, reasoning_used, tools_called, fallback_used, finish_reason,
        input_tokens, output_tokens, total_tokens, cached_tokens, cache_read_tokens,
        cache_write_tokens, cost, routing_latency_ms, provider_latency_ms, total_latency_ms,
        time_to_first_token_ms, tokens_per_second, provider_response_id, provider_status_code,
        error_code, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
    )
    .bind(
      state.requestId,
      usage.generationId ?? null,
      state.startedAt,
      completedAt,
      state.method,
      state.path,
      statusCode,
      state.gatewayKeyId ?? null,
      state.gatewayKeyName ?? null,
      null,
      state.application ?? null,
      state.modelId ?? null,
      model?.provider_id ?? null,
      model?.category ?? null,
      state.stream ? 1 : 0,
      state.reasoningUsed ? 1 : 0,
      usage.toolsCalled ? 1 : 0,
      usage.finishReason ?? null,
      inputTokens ?? null,
      outputTokens ?? null,
      totalTokens ?? null,
      usage.cachedTokens ?? null,
      cacheReadTokens ?? null,
      usage.cacheWriteTokens ?? null,
      cost,
      routingLatencyMs,
      providerLatencyMs,
      totalLatencyMs,
      null,
      tokensPerSecond,
      usage.providerResponseId ?? null,
      response.status,
      state.errorCode ?? null,
      state.errorMessage ?? errorMessage ?? null,
    )
    .run();
}

function sumDefined(a?: number, b?: number): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

function calculateCost(
  model: ModelTelemetryRow | null,
  inputTokens?: number,
  outputTokens?: number,
  cacheReadTokens?: number,
  cacheWriteTokens?: number,
): number | null {
  if (!model) return null;
  const hasPricing = [model.pricing_input, model.pricing_output, model.pricing_cache_read, model.pricing_cache_write].some(
    (value) => value !== null,
  );
  if (!hasPricing) return null;
  // models.dev prices are normalized to USD per million tokens.
  const uncachedInputTokens = Math.max(0, (inputTokens ?? 0) - (cacheReadTokens ?? 0) - (cacheWriteTokens ?? 0));
  return (
    (uncachedInputTokens * (model.pricing_input ?? 0) +
      (outputTokens ?? 0) * (model.pricing_output ?? 0) +
      (cacheReadTokens ?? 0) * (model.pricing_cache_read ?? 0) +
      (cacheWriteTokens ?? 0) * (model.pricing_cache_write ?? 0)) /
    1_000_000
  );
}

async function readUsage(response: Response): Promise<UsageValues> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json") && !contentType.includes("text/event-stream")) return {};
  try {
    const text = await response.clone().text();
    if (contentType.includes("text/event-stream")) return parseSseUsage(text);
    return parseUsage(JSON.parse(text));
  } catch {
    return {};
  }
}

function parseSseUsage(text: string): UsageValues {
  let result: UsageValues = {};
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") continue;
    try {
      result = mergeUsage(result, parseUsage(JSON.parse(value)));
    } catch {
      // Ignore provider-specific non-JSON SSE frames.
    }
  }
  return result;
}

function parseUsage(payload: unknown): UsageValues {
  if (!payload || typeof payload !== "object") return {};
  const value = payload as Record<string, unknown>;
  const response = value.response as Record<string, unknown> | undefined;
  const usage = (value.usage ?? response?.usage) as Record<string, unknown> | undefined;
  const choices = Array.isArray(value.choices) ? (value.choices[0] as Record<string, unknown> | undefined) : undefined;
  const input = numberFrom(usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.promptTokens);
  const output = numberFrom(usage?.completion_tokens ?? usage?.output_tokens ?? usage?.completionTokens);
  const cached = numberFrom(usage?.cached_tokens ?? usage?.cachedTokens);
  const cacheRead = numberFrom(usage?.cache_read_input_tokens ?? usage?.cache_read_tokens ?? usage?.cacheReadTokens);
  const cacheWrite = numberFrom(usage?.cache_creation_input_tokens ?? usage?.cache_write_tokens ?? usage?.cacheWriteTokens);
  return {
    generationId: stringFrom(value.id),
    providerResponseId: stringFrom(value.provider_response_id ?? value.providerResponseId),
    finishReason: stringFrom(choices?.finish_reason ?? choices?.finishReason),
    inputTokens: input,
    outputTokens: output,
    totalTokens: numberFrom(usage?.total_tokens ?? usage?.totalTokens) ?? sumDefined(input, output),
    cachedTokens: cached,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    toolsCalled: stringFrom(choices?.finish_reason ?? choices?.finishReason) === "tool_calls",
  };
}

function mergeUsage(current: UsageValues, next: UsageValues): UsageValues {
  return {
    generationId: next.generationId ?? current.generationId,
    providerResponseId: next.providerResponseId ?? current.providerResponseId,
    finishReason: next.finishReason ?? current.finishReason,
    inputTokens: next.inputTokens ?? current.inputTokens,
    outputTokens: next.outputTokens ?? current.outputTokens,
    totalTokens: next.totalTokens ?? current.totalTokens,
    cachedTokens: next.cachedTokens ?? current.cachedTokens,
    cacheReadTokens: next.cacheReadTokens ?? current.cacheReadTokens,
    cacheWriteTokens: next.cacheWriteTokens ?? current.cacheWriteTokens,
    toolsCalled: next.toolsCalled ?? current.toolsCalled,
  };
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
