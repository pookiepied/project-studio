/**
 * The one re-read a model-written title needs.
 *
 * ---- Why this exists -------------------------------------------------------
 *
 * A conversation's title used to be written only by things this window saw:
 * the derivation at creation, or a person's rename. The harness now names
 * conversations on its own - a small model works for a few seconds after the
 * first exchange settles and then writes the index row - and nothing in this
 * window is told when that lands. The index has no push channel; the list is
 * kept current the way it always has been, by re-reading it when there is
 * reason to believe the world changed. The one such moment this window
 * reliably witnesses is the conversation's first turn settling: the page
 * that sent the message watches the run, and reports the settlement through
 * `markRunning`.
 *
 * The delay is the honest part. At the moment of settlement the title job is
 * only beginning - the harness dispatches it as the exchange settles - so an
 * immediate re-read would almost always read the derived title and prove
 * nothing. One bounded wait, once per conversation, gives a small model on a
 * short prompt its chance; if it is still slower than that, the title
 * arrives at the next natural re-read the way every other cross-window row
 * change already does.
 *
 * Once per conversation, and never re-armed: this is a nudge for one fact,
 * not a polling loop. A conversation whose first turn settles with no
 * tracked id - a conversation this window did not begin - schedules nothing.
 */

/** Long enough for a small model on a few hundred tokens; short enough that
 * the sidebar is not visibly stale. */
const DEFAULT_DELAY_MS = 6000

export interface TitleRefresh {
  /** Marks a conversation whose title may still change after its first turn. */
  track: (conversationId: string) => void
  /** Call when a tracked conversation's turn settles. Fires at most once. */
  settled: (conversationId: string) => void
  /** Cancels a pending refresh; the window is going away. */
  dispose: () => void
}

export function createTitleRefresh(options: {
  /** Re-reads the index. Called at most once per tracked conversation. */
  refresh: () => void
  /** Injectable for tests; production never names it. */
  delayMs?: number
}): TitleRefresh {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const tracked = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    track(conversationId) {
      tracked.add(conversationId)
    },
    settled(conversationId) {
      // Consumed on the first settle, whatever happens later: one nudge per
      // conversation, and a conversation this window did not begin nudges
      // nothing.
      if (!tracked.delete(conversationId)) return
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        options.refresh()
      }, delayMs)
    },
    dispose() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
