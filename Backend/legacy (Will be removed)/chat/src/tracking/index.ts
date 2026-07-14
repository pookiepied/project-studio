// ── Events ───────────────────────────────────────────────────────────────────
export { emit, categoryOf }           from './events';
export type { AIEvent, AITrackEvent } from './events';

// ── Error helpers ─────────────────────────────────────────────────────────────
export { emitError }                  from './errors';

// ── Provider credit snapshots (lives in gateway) ──────────────────────────────
export { fetchAllCredits }            from '@gateway/tracking';

// ── Cost estimation (lives in gateway) ───────────────────────────────────────
export { estimateCostUsd }            from '@gateway/tracking';

// ── Span tracing ──────────────────────────────────────────────────────────────
export { spanStart, spanEnd }         from './spans';
export type { SpanStartParams, SpanEndParams, SpanType, SpanStatus } from './spans';
