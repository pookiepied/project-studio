/**
 * Event taxonomy + emit() — canonical tracking for the auth worker.
 *
 * Adding a new event: add it to AuthEvent below, then call emit() at the
 * right point in src/index.ts. No other file needs to change.
 *
 * All events are written to the tracker worker's events table with
 * worker = 'auth' and category derived from the first dot-segment.
 */

// ── Event taxonomy ────────────────────────────────────────────────────────────

export type AuthEvent =
  // ── Login ───────────────────────────────────────────────────────────────────
  | 'auth.login.success'
  | 'auth.login.failed'
  | 'auth.login.rate_limited'
  // ── Token lifecycle ──────────────────────────────────────────────────────────
  | 'auth.token.refreshed'
  | 'auth.token.refresh_failed'
  | 'auth.token.refresh_rate_limited'
  // ── Session ──────────────────────────────────────────────────────────────────
  | 'auth.logout'
  // ── Google OAuth integration ──────────────────────────────────────────────────
  | 'auth.google.connected'
  | 'auth.google.connect_failed'
  // ── Admin whitelist management ────────────────────────────────────────────────
  | 'auth.admin.whitelist.viewed'
  | 'auth.admin.whitelist.added'
  | 'auth.admin.whitelist.removed'
  // ── API key management ───────────────────────────────────────────────────────
  | 'auth.apikey.created'
  | 'auth.apikey.revoked'
  // ── User lookups ─────────────────────────────────────────────────────────────
  | 'auth.users.batch_lookup';

/** Derives the event category from the event name (the first dot-segment). */
export function categoryOf(event: AuthEvent): string {
  const dot = event.indexOf('.');
  return dot === -1 ? event : event.slice(0, dot);
}

// ── emit() ────────────────────────────────────────────────────────────────────

export interface AuthTrackEvent {
  event:     AuthEvent;
  severity?: 'debug' | 'info' | 'warn' | 'error';
  userId?:   string;
  data?:     Record<string, unknown>;
}

interface HasTracker {
  TRACKER?: Fetcher;
}

/**
 * Fire-and-forget event emission for the auth worker.
 *
 * Uses ctx.waitUntil() so the fetch survives after the response is sent.
 * Never throws — tracking must not affect the auth flow.
 */
export function emit(
  env: HasTracker,
  ctx: ExecutionContext,
  e:   AuthTrackEvent,
): void {
  if (!env.TRACKER) return;
  ctx.waitUntil(
    env.TRACKER.fetch('https://tracker/ingest', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event:    e.event,
        category: categoryOf(e.event),
        worker:   'auth',
        severity: e.severity ?? 'info',
        userId:   e.userId,
        data:     e.data,
      }),
    }).catch(() => {})
  );
}
