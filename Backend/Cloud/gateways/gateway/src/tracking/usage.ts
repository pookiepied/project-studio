/**
 * recordUsage() — fires a best-effort usage insert to the tracker worker.
 *
 * Captures token counts, cost, latency, and request metadata for every
 * AI request that goes through the gateway: chat, TTS, STT, image, video.
 *
 * Uses ctx.waitUntil() when ExecutionContext is available (guarantees the
 * fetch completes even after the Response is returned). Falls back to
 * fire-and-forget when ctx is absent (e.g. called from a tool or DO).
 */

import type { GatewayEnv } from '../env';
import { CapturedUsage } from '../providers/types';
import { estimateCostUsd } from './pricing';

export interface TrackingParams {
  env:           GatewayEnv;
  ctx?:          ExecutionContext;
  userId:        string | undefined;
  provider:      string;
  model:         string;
  capturedUsage: CapturedUsage | null;
  requestStart:  number;
  requestType?:  'chat' | 'audio' | 'tts' | 'image' | 'video' | 'embedding';
  status?:       'success' | 'error' | 'timeout';
  errorType?:    string;
  source?:       string;
  toolCallCount?:    number;
  iterationCount?:   number;
  inputPreview?:     string;
  runId?:            string;
}

export function recordUsage(params: TrackingParams): void {
  if (!params.env.TRACKER) return;

  const {
    ctx,
    userId,
    provider,
    model,
    capturedUsage,
    requestStart,
    requestType  = 'chat',
    status       = 'success',
    errorType,
    source,
    toolCallCount,
    iterationCount,
    inputPreview,
    runId,
  } = params;

  // Build body async so we can do a KV pricing lookup without blocking the response.
  const promise = (async () => {
    const estimatedCost = capturedUsage?.cost == null
      ? await estimateCostUsd(
          null,
          model,
          capturedUsage?.prompt_tokens  ?? null,
          capturedUsage?.completion_tokens ?? null,
          params.env,
        )
      : null;

    return params.env.TRACKER!.fetch('https://tracker/ingest/usage', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId:            userId ?? 'anonymous',
        provider,
        model,
        inputTokens:       capturedUsage?.prompt_tokens              ?? null,
        outputTokens:      capturedUsage?.completion_tokens          ?? null,
        cacheReadTokens:   capturedUsage?.cache_read_input_tokens    ?? null,
        cacheWriteTokens:  capturedUsage?.cache_creation_input_tokens ?? null,
        reasoningTokens:   capturedUsage?.reasoning_tokens           ?? null,
        costUsd:           capturedUsage?.cost                       ?? null,
        estimatedCostUsd:  estimatedCost,
        latencyMs:         Date.now() - requestStart,
        inputPreview:      inputPreview  ?? null,
        generationId:      capturedUsage?.id                         ?? null,
        requestType,
        status,
        errorType:         errorType      ?? null,
        source:            source         ?? null,
        toolCallCount:     toolCallCount  ?? null,
        iterationCount:    iterationCount ?? null,
        runId:             runId          ?? null,
      }),
    });
  })().catch(() => {});

  if (ctx) {
    ctx.waitUntil(promise);
  }
  // If no ctx: fire-and-forget (tool calls deep in agent loop, DO context).
}
