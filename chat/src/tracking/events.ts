/**
 * Event taxonomy + emit() — canonical location for all AI worker observability events.
 *
 * This is the single source of truth for:
 *   - The AIEvent union type  (add new events here — nowhere else)
 *   - emit()                  (fire-and-forget delivery to the tracker worker)
 *
 * Import from 'src/tracking', not from gateway/tracking or lib/tracking.
 */

import type { GatewayEnv } from '../gatewayEnv';
import { getRequestCtx } from '../context';

// ── Event taxonomy ────────────────────────────────────────────────────────────
//
// Naming convention:  <domain>.<noun>.<verb_or_state>
// Adding a new event: add it to the union below, then call emit() at the right
// point in the pipeline. No other file needs to change.

export type AIEvent =
  // ── Chat lifecycle ──────────────────────────────────────────────────────────
  | 'chat.request.started'
  | 'chat.request.completed'
  | 'chat.request.failed'
  // ── Router ──────────────────────────────────────────────────────────────────
  | 'router.decided'
  // ── Preload ─────────────────────────────────────────────────────────────────
  | 'preload.mcp.failed'
  | 'preload.composio.failed'
  // ── Streaming ───────────────────────────────────────────────────────────────
  | 'stream.phase1.failed'
  | 'stream.timeout'
  // ── Agent ───────────────────────────────────────────────────────────────────
  | 'agent.local_tools.pending'
  // ── Sub-agent lifecycle (research sub-agent DOs in studio-agents) ──────────
  | 'agent.subagent.started'
  | 'agent.subagent.completed'
  | 'agent.subagent.failed'
  | 'agent.subagent.timed_out'
  // ── Memory operations ────────────────────────────────────────────────────────
  | 'memory.write'
  | 'memory.read'
  | 'memory.list'
  | 'memory.update'
  | 'memory.delete'
  | 'memory.log_periodic'
  | 'memory.get_period'
  // ── Provider errors ──────────────────────────────────────────────────────────
  | 'provider.error';

/** Derives the event category from the event name (the first dot-segment). */
export function categoryOf(event: AIEvent): string {
  const dot = event.indexOf('.');
  return dot === -1 ? event : event.slice(0, dot);
}

// ── emit() ────────────────────────────────────────────────────────────────────

export interface AITrackEvent {
  event:     AIEvent;
  severity?: 'debug' | 'info' | 'warn' | 'error';
  userId?:   string;
  runId?:    string;
  data?:     Record<string, unknown>;
}

/**
 * Fire-and-forget event emission for the AI worker.
 *
 * ctx is optional: if omitted, auto-resolves from getRequestCtx() so that tools
 * deep in the call chain (image_generate, video_generate, etc.) can emit events
 * without threading ExecutionContext through every layer.
 *
 * Never throws. Safe to call from streaming, non-streaming, tools, DO context,
 * and timeout paths. When no ctx is available (e.g. inside a Durable Object),
 * the fetch is initiated fire-and-forget — the DO runtime keeps it alive.
 */
export function emit(
  env: GatewayEnv,
  ctx: ExecutionContext | undefined,
  e: AITrackEvent,
): void {
  if (!env.TRACKER) return;
  const resolvedCtx = ctx ?? getRequestCtx();
  const promise = env.TRACKER.fetch('https://tracker/ingest', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event:    e.event,
      category: categoryOf(e.event),
      worker:   'ai',
      severity: e.severity ?? 'info',
      userId:   e.userId,
      runId:    e.runId,
      data:     e.data,
    }),
  }).catch((err) => console.warn("[TRACKER] ingest failed:", e.event, String(err)));
  if (resolvedCtx) {
    resolvedCtx.waitUntil(promise);
  }
  // else: fire-and-forget — DO runtime keeps in-flight fetch alive
}
