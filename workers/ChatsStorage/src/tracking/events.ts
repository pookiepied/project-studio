/**
 * Event taxonomy + emit() — canonical tracking for the ChatsStorage worker.
 *
 * ChatsStorage is a private R2-backed storage layer called only via service
 * binding from the API worker. Tracking here gives you structured R2 usage
 * data: read/write/delete counts, file sizes, and 404 rates — useful for
 * understanding R2 storage costs and access patterns.
 *
 * Adding a new event: add it to ChatsEvent below, then call emit() at the
 * relevant point in src/index.ts. No other file needs to change.
 */

// ── Event taxonomy ────────────────────────────────────────────────────────────

export type ChatsEvent =
  // ── R2 operations ────────────────────────────────────────────────────────────
  | 'chat.storage.read'
  | 'chat.storage.not_found'
  | 'chat.storage.written'
  | 'chat.storage.deleted'
  | 'chat.storage.checked'
  | 'chat.storage.error';

/** Derives the event category from the event name (the first dot-segment). */
export function categoryOf(event: ChatsEvent): string {
  const dot = event.indexOf('.');
  return dot === -1 ? event : event.slice(0, dot);
}

// ── emit() ────────────────────────────────────────────────────────────────────

export interface ChatsTrackEvent {
  event:     ChatsEvent;
  severity?: 'debug' | 'info' | 'warn' | 'error';
  userId?:   string;
  data?:     Record<string, unknown>;
}

interface HasTracker {
  TRACKER?: Fetcher;
}

/**
 * Fire-and-forget event emission for the ChatsStorage worker.
 *
 * Uses ctx.waitUntil() so the fetch survives after the response is sent.
 * Never throws — tracking must not affect storage operations.
 */
export function emit(
  env: HasTracker,
  ctx: ExecutionContext,
  e:   ChatsTrackEvent,
): void {
  if (!env.TRACKER) return;
  ctx.waitUntil(
    env.TRACKER.fetch('https://tracker/ingest', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event:    e.event,
        category: categoryOf(e.event),
        worker:   'chats',
        severity: e.severity ?? 'info',
        userId:   e.userId,
        data:     e.data,
      }),
    }).catch(() => {})
  );
}
