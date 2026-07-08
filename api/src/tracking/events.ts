/**
 * Event taxonomy + emit() — canonical tracking for the API worker.
 *
 * Adding a new event: add it to APIEvent below, then call emit() at the
 * right point in the relevant route file. No other file needs to change.
 *
 * All events are written to the tracker worker's events table with
 * worker = 'api' and category derived from the first dot-segment.
 */

// ── Event taxonomy ────────────────────────────────────────────────────────────

export type APIEvent =
  // ── Job lifecycle (user-facing) ──────────────────────────────────────────────
  | 'job.created'
  | 'job.cancelled'
  // ── Job lifecycle (engine-facing) ────────────────────────────────────────────
  | 'job.claimed'
  | 'job.completed'
  | 'job.failed'
  | 'job.progress.updated'
  // ── Checkpoints ──────────────────────────────────────────────────────────────
  | 'job.checkpoint.saved'
  | 'job.checkpoint.loaded'
  // ── Reaper (cron) ────────────────────────────────────────────────────────────
  | 'job.reaper.reset'
  | 'job.reaper.dead_lettered'
  // ── Engine connectivity ───────────────────────────────────────────────────────
  | 'engine.tasks.registered'
  // ── Auth anomalies ────────────────────────────────────────────────────────────
  | 'job.auth.missing_sub'
  // ── Updates ──────────────────────────────────────────────────────────────────
  | 'update.check'
  | 'update.download';

/** Derives the event category from the event name (the first dot-segment). */
export function categoryOf(event: APIEvent): string {
  const dot = event.indexOf('.');
  return dot === -1 ? event : event.slice(0, dot);
}

// ── emit() ────────────────────────────────────────────────────────────────────

export interface APITrackEvent {
  event:     APIEvent;
  severity?: 'debug' | 'info' | 'warn' | 'error';
  userId?:   string;
  runId?:    string;
  data?:     Record<string, unknown>;
}

interface HasTracker {
  TRACKER?: Fetcher;
}

/**
 * Fire-and-forget event emission for the API worker.
 *
 * Uses ctx.waitUntil() so the fetch survives after the response is sent.
 * Never throws — tracking must not affect request handling.
 */
export function emit(
  env: HasTracker,
  ctx: ExecutionContext,
  e:   APITrackEvent,
): void {
  if (!env.TRACKER) return;
  ctx.waitUntil(
    env.TRACKER.fetch('https://tracker/ingest', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event:    e.event,
        category: categoryOf(e.event),
        worker:   'api',
        severity: e.severity ?? 'info',
        userId:   e.userId,
        runId:    e.runId,
        data:     e.data,
      }),
    }).catch(() => {})
  );
}
