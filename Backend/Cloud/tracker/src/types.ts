/// <reference types="@cloudflare/workers-types" />

export interface Env {
  TRACKER_DB: D1Database;
  ENVIRONMENT?: string;
}

export type WorkerName = 'ai' | 'api' | 'auth' | 'chats';
export type Severity = 'debug' | 'info' | 'warn' | 'error';
export type SpanType = 'llm' | 'tool' | 'chain' | 'node' | 'agent';
export type SpanStatus = 'running' | 'success' | 'error';

export interface TrackEvent {
  event: string;
  category: string;
  worker: WorkerName;
  severity?: Severity;
  userId?: string;
  sessionId?: string;
  runId?: string;
  spanId?: string;
  parentSpanId?: string;
  data?: Record<string, unknown>;
}

export interface SpanStartPayload {
  spanId: string;
  runId: string;
  parentSpanId?: string;
  spanType: SpanType;
  name: string;
  userId?: string;
  inputPreview?: string;
  metadata?: Record<string, unknown>;
}

export interface SpanEndPayload {
  status: 'success' | 'error';
  outputPreview?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  error?: string;
}

/** Payload for POST /ingest/usage — one per AI request. */
export interface UsageEventPayload {
  userId: string;
  provider: string;
  model: string;
  inputTokens?:       number | null;
  outputTokens?:      number | null;
  cacheReadTokens?:   number | null;
  cacheWriteTokens?:  number | null;
  costUsd?:           number | null;
  estimatedCostUsd?:  number | null;
  latencyMs?:         number | null;
  inputPreview?:      string | null;
  generationId?:      string | null;
  requestType?:       'chat' | 'audio' | 'tts' | 'image' | 'video' | 'embedding';
  status?:            'success' | 'error' | 'timeout';
  errorType?:         string | null;
  source?:            string | null;
  toolCallCount?:     number | null;
  iterationCount?:    number | null;
  runId?:             string | null;
}

/** Payload for POST /ingest/credits — latest balance per provider. */
export interface CreditsPayload {
  provider:      string;
  balance_usd:   number | null;
  used_usd:      number | null;
  purchased_usd: number | null;
  raw_response:  Record<string, unknown> | null;
  updated_at:    string;
}
