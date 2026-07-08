// Shared tracker client — copy this file into src/lib/tracker.ts in every worker.
// Requires a TRACKER service binding (type: Fetcher) in that worker's wrangler.toml.
//
// Usage:
//   import { track, spanStart, spanEnd } from './lib/tracker';
//   track('auth', env, ctx, { event: 'auth.login.success', category: 'auth', userId });

export type WorkerName = 'ai' | 'api' | 'auth' | 'chats' | 'memory';
export type Severity   = 'debug' | 'info' | 'warn' | 'error';
export type SpanType   = 'llm' | 'tool' | 'chain' | 'node' | 'agent';
export type SpanStatus = 'success' | 'error';

export interface TrackEvent {
  event:         string;
  category:      string;
  severity?:     Severity;
  userId?:       string;
  sessionId?:    string;
  runId?:        string;
  spanId?:       string;
  parentSpanId?: string;
  data?:         Record<string, unknown>;
}

export interface SpanStart {
  spanId:         string;
  runId:          string;
  parentSpanId?:  string;
  spanType:       SpanType;
  name:           string;
  userId?:        string;
  inputPreview?:  string;
  metadata?:      Record<string, unknown>;
}

export interface SpanEnd {
  spanId:         string;
  status:         SpanStatus;
  outputPreview?: string;
  tokensIn?:      number;
  tokensOut?:     number;
  costUsd?:       number;
  error?:         string;
}

interface HasTracker {
  TRACKER?: Fetcher;
}

function send(env: HasTracker, ctx: ExecutionContext, path: string, body: unknown): void {
  if (!env.TRACKER) return;
  ctx.waitUntil(
    env.TRACKER.fetch(`https://tracker${path}`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(body),
    }).catch(() => {})  // never let tracking errors surface to users
  );
}

export function track(
  worker: WorkerName,
  env:    HasTracker,
  ctx:    ExecutionContext,
  event:  TrackEvent
): void {
  send(env, ctx, '/ingest', { ...event, worker });
}

export function spanStart(
  env:  HasTracker,
  ctx:  ExecutionContext,
  span: SpanStart
): void {
  send(env, ctx, '/ingest/span', span);
}

export function spanEnd(
  env:  HasTracker,
  ctx:  ExecutionContext,
  span: SpanEnd
): void {
  const { spanId, ...rest } = span;
  send(env, ctx, `/ingest/span/${spanId}/end`, rest);
}
