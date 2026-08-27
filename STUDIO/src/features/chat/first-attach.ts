/**
 * The admission receipt handed across a navigation.
 *
 * A conversation's first turn is admitted from a page that has no reader:
 * home and a project page submit, and the conversation view mounts afterwards
 * (see `first-turn.ts`). Both halves of the receipt matter on the other side.
 * The offset is where that turn's events begin, and carrying it avoids the
 * exact race Task 32 removed from `submit()` — a cold history read for a
 * stream created milliseconds ago, which when the 404 wins leaves the read
 * `absent` and the turn unwitnessed. The submission id is what lets the
 * conversation open in `submitted` rather than in `attaching`, so the first
 * turn of a conversation is as watchable as its second: the page says a turn
 * is running because the harness said it admitted one.
 *
 * The entry is not consumed on read. Two reasons, and only the second is
 * about React: attaching from a first turn's offset is idempotent, because
 * there is no history before it to miss, so handing it to two attaches costs
 * nothing; and StrictMode mounts the conversation view twice, so a take that
 * deleted would give the surviving mount a cold start again. What retires it
 * is a read reaching `up-to-date` — the moment a reader has caught up to the
 * present is the moment the handoff has done its whole job.
 */
export interface FirstAdmission {
  /** Opaque stream offset from the receipt. Reading from here yields the turn. */
  readonly offset: string
  /** The submission the harness admitted, verbatim from the receipt. */
  readonly submissionId: string
  /**
   * What was typed. Not part of the receipt — the harness has these words
   * already and would echo them back — but the echo is a round trip, and the
   * view that mounts here would otherwise open on an empty column for its
   * length. The submission id above is what retires them; see
   * `PendingSubmission`.
   */
  readonly text: string
  /**
   * When the receipt was answered — the earliest this side knew the turn
   * existed. Nothing reads it. It was the anchor for a row that counted the
   * wait, and that row is gone: what the screen reports about time is now a
   * reasoning run's own span, and the silence in front of that is drawn by
   * nothing. Kept because a receipt without the moment it arrived is a
   * smaller fact than one with it, and the next thing that measures a wait
   * will want it — not because anything measures one today.
   */
  readonly at: number
}

const pending = new Map<string, FirstAdmission>()

/** Records the receipt a just-admitted first turn was answered with. */
export function rememberFirstAdmission(
  conversationId: string,
  admission: FirstAdmission,
): void {
  pending.set(conversationId, admission)
}

/** The receipt a first attach should open from, or null for a cold start. */
export function firstAdmission(conversationId: string): FirstAdmission | null {
  return pending.get(conversationId) ?? null
}

/** Retires the handoff once a read has caught up to the present. */
export function forgetFirstAdmission(conversationId: string): void {
  pending.delete(conversationId)
}
