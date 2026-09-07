import type { UsageFacts } from '@/platform/harness'

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
 * turn, fork, retry, delete a reply - the transcript changes and the number
 * does not, because nothing recomputes it. It only ever went up.
 *
 * And seeding it meant every conversation in the demo opened above the
 * threshold, so the meter appeared on all of them at once, at values with no
 * relationship to how long any of them actually were. A meter that reads 72%
 * on a four-message conversation is not information, and once the reader
 * notices it is arbitrary they stop believing the rest of the chrome too.
 *
 * Derived, it cannot lie: it is a function of what is on screen, so it drops
 * when a fork shortens the history and rises as you talk.
 *
 * ---- Measured first, estimated only where nothing measured ----------------
 *
 * This file used to be an estimate over the stored `messages` array, which is
 * empty for every live conversation - so the meter it fed drew nothing, ever.
 * The provider's own usage is the figure now, and the estimate survives for
 * exactly one job: the stretch of transcript newer than the last turn that
 * reported. Four characters to the token is the usual rough figure for
 * English prose and it is what that stretch uses. Being ten percent out over
 * one message never changes the answer the ring exists to give, and the panel
 * marks the row as an estimate rather than letting it pass as a measurement.
 */

/** Characters per token. A rough average, and rough is sufficient here. */
const CHARS_PER_TOKEN = 4

/** Used when no model is selected, or the selected one declares no window. */
const FALLBACK_WINDOW = 200_000

/* -------------------------------------------------------------------------- */
/* The breakdown                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What one turn actually cost, in the only divisions the provider reports.
 *
 * There are exactly three, and the temptation is to invent more. A panel
 * itemising "system prompt", "tool definitions", "MCP tools", "skills" and
 * "memory files" would be a better-looking panel and a dishonest one: no
 * provider reports any of that, and the harness does not count the sections
 * of the prompt it assembles. Every one of those rows would be a number this
 * app made up. What is real is what was sent, how much of it the provider
 * already had cached, and what came back - so that is what this holds.
 */
export interface MeasuredContext {
  /** Prompt tokens the provider billed as fresh. */
  readonly fresh: number
  /** Prompt tokens served from cache: read back, plus what was written. */
  readonly cached: number
  /** What the model produced, reasoning included where a provider bills it so. */
  readonly reply: number
}

/**
 * A conversation's context, measured where it can be and estimated after.
 *
 * Two halves, kept apart all the way to the screen. `measured` is the last
 * turn the provider reported on, and it is the truth. `pending` is everything
 * the transcript has gained since - the message just sent, the reply still
 * arriving - which no turn has reported yet and which is therefore estimated
 * from its characters.
 *
 * Without the second half the ring stood still from the moment a message was
 * sent until the reply landed, and then jumped. With it the ring moves while
 * the turn runs and then settles onto the measured figure, which is both
 * livelier and more honest: the estimate is labelled as one wherever it shows.
 */
export interface ContextReport {
  readonly measured: MeasuredContext | null
  /** Estimated tokens for everything after the last turn that reported. */
  readonly pending: number
}

/** An item's own text, for the estimate. Tool output is not the transcript's. */
function itemCharacters(item: TranscriptLike): number {
  if (item.kind === 'user') return item.text?.length ?? 0
  let total = 0
  for (const segment of item.segments ?? []) total += segment.text?.length ?? 0
  return total
}

interface TranscriptLike {
  readonly kind: string
  readonly usage?: UsageFacts | null
  readonly text?: string
  readonly segments?: readonly { readonly kind: string; readonly text?: string }[]
}

/**
 * The report for one transcript.
 *
 * Walks back to the last item carrying usage, takes that as the measurement,
 * and estimates everything after it. A transcript with no usage anywhere is
 * all estimate, which is a conversation whose first reply has not landed.
 */
export function contextReport(items: readonly TranscriptLike[]): ContextReport {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const usage = items[index]?.usage
    if (usage === undefined || usage === null) continue
    const fresh = usage.input ?? 0
    const cached = (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
    const reply = usage.output ?? 0
    if (fresh + cached + reply === 0) continue
    let characters = 0
    for (let after = index + 1; after < items.length; after += 1) {
      characters += itemCharacters(items[after])
    }
    return {
      measured: { fresh, cached, reply },
      pending: Math.round(characters / CHARS_PER_TOKEN),
    }
  }
  let characters = 0
  for (const item of items) characters += itemCharacters(item)
  return { measured: null, pending: Math.round(characters / CHARS_PER_TOKEN) }
}

/** One turn's measured total: the whole prompt plus what it produced. */
export function measuredTotal(measured: MeasuredContext): number {
  return measured.fresh + measured.cached + measured.reply
}

export interface ContextBreakdown {
  readonly report: ContextReport
  /** The window the fractions are against, and whether the model named it. */
  readonly window: number
  readonly windowDeclared: boolean
  readonly total: number
  /** Never negative: a turn may overrun a window the catalog understates. */
  readonly free: number
  /** The total as a fraction of the window, clamped to one. */
  readonly used: number
}

/** The report against one model's window, which is what the ring draws. */
export function contextBreakdown(
  report: ContextReport,
  contextWindow: number | 'unknown' | null,
): ContextBreakdown {
  const declared = typeof contextWindow === 'number' && contextWindow > 0
  const window = declared ? contextWindow : FALLBACK_WINDOW
  const total = (report.measured === null ? 0 : measuredTotal(report.measured)) + report.pending
  return {
    report,
    window,
    windowDeclared: declared,
    total,
    free: Math.max(0, window - total),
    used: Math.min(1, total / window),
  }
}

/* -------------------------------------------------------------------------- */
/* Reading the numbers                                                         */
/* -------------------------------------------------------------------------- */

/** One decimal place, with a trailing zero dropped: 1.0 reads as 1. */
function shorten(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/**
 * A token count as a person reads it.
 *
 * `11,600` and `1,000,000` are numbers to calculate with; nobody calculates
 * with these. What a reader wants from the context meter is a magnitude they
 * can compare at a glance - is this a tenth of the window or most of it - and
 * seven digits are actively worse at that than two characters, because the
 * eye has to count the groups before it knows the size.
 *
 * So: under a thousand is itself, because at that size the exact figure is
 * shorter than any abbreviation of it. Below ten thousand keeps one decimal,
 * where the difference between 1.2k and 9.4k is the whole story. Above that
 * the decimal is noise and it rounds to whole thousands. A million or more
 * reads in millions, because that is how the windows themselves are quoted -
 * a model advertises a 1M window, never a 1,000k one.
 *
 * The rounding is deliberately allowed to be visible: 999,600 reads as 1M
 * rather than 1000k, because the alternative is a unit nobody uses.
 */
export function formatTokens(value: number): string {
  const rounded = Math.max(0, Math.round(value))
  if (rounded < 1_000) return String(rounded)

  const millions = Math.round((rounded / 1_000_000) * 10) / 10
  if (millions >= 1) return `${shorten(millions)}M`

  const thousands = rounded / 1_000
  if (thousands < 10) return `${shorten(thousands)}k`
  return `${Math.round(thousands)}k`
}
