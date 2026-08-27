import type { Conversation } from '@/domain/session/types'

/**
 * How much of the context window a conversation is using.
 *
 * ---- Why this is derived and not stored ----------------------------------
 *
 * It used to be a number on the conversation, incremented a little on every
 * turn and seeded with a plausible-looking value in the demo data. Two things
 * were wrong with that, and the second is the one that showed.
 *
 * A stored figure can disagree with the messages it claims to describe. Edit a
 * turn, fork, retry, delete a reply — the transcript changes and the number
 * does not, because nothing recomputes it. It only ever went up.
 *
 * And seeding it meant every conversation in the demo opened above the
 * threshold, so the meter appeared on all of them at once, at values with no
 * relationship to how long any of them actually were. A meter that reads 72% on
 * a four-message conversation is not information, and once the reader notices
 * it is arbitrary they stop believing the rest of the chrome too.
 *
 * Derived, it cannot lie: it is a function of what is on screen, so it drops
 * when a fork shortens the history and rises as you talk.
 *
 * ---- On the estimate -----------------------------------------------------
 *
 * Four characters to the token is the usual rough figure for English prose and
 * it is what this uses. It is an estimate and it is allowed to be: the meter
 * exists to say "you are getting close", and being ten percent out never
 * changes that answer. When the harness reports real usage this function is
 * where that arrives, and nothing else has to change.
 */

/** Characters per token. A rough average, and rough is sufficient here. */
const CHARS_PER_TOKEN = 4

/** Every turn costs a little beyond its text: role, delimiters, tool framing. */
const PER_MESSAGE_OVERHEAD = 8

/** Used when no model is selected, or the selected one declares no window. */
const FALLBACK_WINDOW = 200_000

/**
 * The selected model's own window, from the catalog the harness served; null
 * when nothing is selected or the model does not declare one.
 */
export function contextUsage(conversation: Conversation, contextWindow: number | 'unknown' | null): number {
  const window = typeof contextWindow === 'number' && contextWindow > 0 ? contextWindow : FALLBACK_WINDOW

  const tokens = conversation.messages.reduce((total, message) => {
    // The reasoning trace occupies the window too, and on a long chain of
    // thought it is the larger half. Counting only the reply would make the
    // meter read low on exactly the conversations most at risk of filling up.
    const thinking = message.thinking?.text.length ?? 0
    return total + (message.text.length + thinking) / CHARS_PER_TOKEN + PER_MESSAGE_OVERHEAD
  }, 0)

  return Math.min(1, tokens / window)
}
