/**
 * Span tracing — open and close LangGraph execution spans in the tracker worker.
 *
 * Each agent run is identified by a runId (= requestId in the pipeline). Within
 * a run there can be multiple spans (llm calls, tool calls, sub-agents). The
 * tracker's spans table stores these with parent/child relationships so the
 * /runs/:runId endpoint can reconstruct the full execution tree.
 *
 * Usage:
 *   const spanId = crypto.randomUUID();
 *   spanStart({ env, spanId, runId: state.requestId, spanType: 'llm', name: state.modelId, userId });
 *   try {
 *     // ... do work ...
 *     spanEnd({ env, spanId, status: 'success', tokensIn: 100, tokensOut: 200 });
 *   } catch (err) {
 *     spanEnd({ env, spanId, status: 'error', error: err.message });
 *     throw err;
 *   }
 */

import { Env }           from '../env';
import { getRequestCtx } from '../context';

export type SpanType   = 'llm' | 'tool' | 'chain' | 'node' | 'agent';
export type SpanStatus = 'success' | 'error';

export interface SpanStartParams {
  env:           Env;
  spanId:        string;
  runId:         string;
  parentSpanId?: string;
  spanType:      SpanType;
  name:          string;
  userId?:       string;
  inputPreview?: string;
  metadata?:     Record<string, unknown>;
}

export interface SpanEndParams {
  env:            Env;
  spanId:         string;
  status:         SpanStatus;
  outputPreview?: string;
  tokensIn?:      number;
  tokensOut?:     number;
  costUsd?:       number;
  error?:         string;
}

function sendSpan(env: Env, path: string, body: unknown): void {
  if (!env.TRACKER) return;
  const ctx = getRequestCtx();
  const promise = env.TRACKER.fetch(`https://tracker${path}`, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  }).catch(() => {});
  if (ctx) {
    ctx.waitUntil(promise);
  }
  // else: fire-and-forget — DO runtime keeps in-flight fetch alive
}

/** Open a new span. Call this immediately before the work starts. */
export function spanStart(params: SpanStartParams): void {
  const { env, spanId, runId, parentSpanId, spanType, name, userId, inputPreview, metadata } = params;
  sendSpan(env, '/ingest/span', {
    spanId,
    runId,
    parentSpanId,
    spanType,
    name,
    userId,
    inputPreview: inputPreview ? inputPreview.slice(0, 500) : undefined,
    metadata,
  });
}

/** Close a span with its outcome. Call this in both success and error paths. */
export function spanEnd(params: SpanEndParams): void {
  const { env, spanId, status, outputPreview, tokensIn, tokensOut, costUsd, error } = params;
  sendSpan(env, `/ingest/span/${spanId}/end`, {
    status,
    outputPreview: outputPreview ? outputPreview.slice(0, 500) : undefined,
    tokensIn,
    tokensOut,
    costUsd,
    error,
  });
}
