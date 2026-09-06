import { useEffect, useState } from 'react'
import { Icons } from '@/components/icons'
import { cn } from '@/lib/cn'
import { DisclosureRow } from './DisclosureRow'

/**
 * The reasoning trace.
 *
 * Collapsed by default, always. The trace is working-out, not the answer, and
 * opening it by default puts the least useful text in a reply at the top of it
 * — the reader has to scroll past somebody else's notes to reach the point.
 * It stays collapsed while streaming too, so the block does not expand and
 * shove the reply down the screen mid-sentence.
 *
 * The header still earns its place while collapsed by carrying the duration:
 * "Thought for 4s" is the one fact about the trace that is worth a glance
 * without opening it, and while the run is live the same number counts up, so
 * a long silence is legible as work rather than as a stall.
 *
 * ---- This row exists only when the reasoning does ---------------------------
 *
 * It appears at the first reasoning delta and not one moment before, and its
 * clock starts there too. That is the whole rule, and it replaced a two-stage
 * arrangement where a `working` row stood in for the silence beforehand and
 * counted it.
 *
 * The silence is real — measured against the provider, most of a turn's wait
 * happens before anything comes back — but naming it was the problem. Called
 * "Thinking" it claimed something this window could not see. Called "Working"
 * it said only "a turn is running", which the ring on the send control already
 * says, at the reader's own hand, from the instant they send. Two indicators
 * for one fact, and the vaguer one sat in the transcript pretending to be
 * content. So the transcript now says nothing while there is nothing to say.
 *
 * The consequence is worth stating because it looks like a bug: on a provider
 * that delivers its whole trace in one batch — Google does, measured at 320ms
 * before the answer where the wait was three seconds — this row appears late
 * and says "Thought" with no number. That is not a lost measurement. It is the
 * honest report of a trace that was seen once, and the alternative is charging
 * the model for a wait nobody here watched it spend.
 *
 * While the run is live its clock runs — a genuine one, ticking every second
 * against a recorded start, not a progress animation dressed up as a
 * measurement. A run with no recorded start — anything replayed or seeded —
 * says only "Thought", because this window did not watch it and cannot report
 * its length.
 *
 * The row is a `DisclosureRow` — the shape every secondary row of a reply
 * shares — so the trace opens at the same content boundary the prose does,
 * and the geometry lives there rather than here.
 *
 * The mark is the thinking concept's own glyph, a lightbulb: an idea
 * arriving, which is what a reasoning run is. It is deliberately still. While
 * the run is live the label shimmers — a valley of lower opacity sweeping
 * the words, the Thinking + Reasoning component of aicss.dev adapted into
 * this theme's own colour — and that sweep is the one thing moving. The
 * brand mark that used to sit here rippled to say the same thing, and one
 * state on one channel is the rule that retired it: two indicators for one
 * fact, and the vaguer one wins no argument by being the brand.
 */
export function ThinkingBlock({
  text,
  span,
  live,
}: {
  /**
   * The trace so far. Empty between the run opening and its first delta, which
   * is a run with nothing to disclose YET — the row still says the model is
   * thinking, because a reasoning run exists, and simply is not a control.
   */
  text: string
  span: ThinkingSpan
  live: boolean
}) {
  const trace = text.trim() === '' ? null : text
  const [open, setOpen] = useState(false)
  useTick(live && span.kind === 'measured')
  const seconds = spanSeconds(span, live)

  // Plain text, changing in place. These words used to cross-fade, back when
  // the row could switch between two different claims about what it was
  // watching; there is one claim now, and the only change left is "Thinking
  // for 7s" becoming "Thought for 7s" as the run ends. Fading between two
  // strings that differ by a tense reads as a flicker, and the shimmer
  // sweeping them stops at exactly that moment, which is the beat the
  // transition was for.
  const shown = (
    <span className={cn('inline-block whitespace-nowrap', live && 'studio-shimmer')}>
      {label(live, seconds)}
    </span>
  )

  return (
    <DisclosureRow
      className="mb-2.5"
      leading={<Icons.thinking />}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      disabled={trace === null}
      chevron="hover"
      entering={live}
      label={shown}
    >
      <div className="studio-selectable text-caption whitespace-pre-wrap text-muted-foreground">
        {trace}
      </div>
    </DisclosureRow>
  )
}

/**
 * How this row knows how long the thinking took — and the two answers are
 * genuinely different kinds of thing, so the caller has to say which it has.
 *
 * `measured` is a live conversation: two moments this window recorded, and a
 * duration derived from them. `stated` is the artifact gallery, which is a
 * scripted display rather than a conversation with an agent — its number was
 * written down, not observed. Collapsing the two into a bare `seconds` is what
 * let a measured zero and a stated zero mean the same thing on screen.
 */
export type ThinkingSpan =
  | { readonly kind: 'stated'; readonly seconds: number }
  | {
      readonly kind: 'measured'
      /** When this window began waiting for the reply this run belongs to. */
      readonly since: number | null
      /** When this run's last delta landed; null while none has, or on a replay. */
      readonly until: number | null
    }

/**
 * The duration to show, or null when this row cannot honestly report one.
 *
 * A live measured run has no end yet, so it is read against the clock and the
 * hook below re-reads it every second. A finished one is read against the last
 * delta that landed. Either way the start is a moment that was recorded here;
 * without one there is no measurement, and the row says so by saying nothing.
 */
function spanSeconds(span: ThinkingSpan, live: boolean): number | null {
  if (span.kind === 'stated') return span.seconds
  if (span.since === null) return null
  // A finished run whose two timestamps are the same instant was seen ONCE.
  // That is not a span of zero, and rendering it as one would put "Thought
  // for a moment" over a trace that may have taken the model ten seconds to
  // produce. It is the common case on a provider that emits its reasoning in
  // a single batch at the end, which is most of them.
  if (!live && span.until !== null && span.until <= span.since) return null
  const end = live || span.until === null ? Date.now() : span.until
  const elapsed = (end - span.since) / 1000
  return elapsed < 0 ? null : elapsed
}

/**
 * Re-renders once a second while a run is live, so a running clock advances.
 *
 * A second is the resolution the label has — it never shows anything finer —
 * so anything faster would be repainting a string that cannot change. The
 * interval exists only while `live`, and it drives nothing but this number:
 * no state is cleared by it, nothing recovers because of it, and if it never
 * fired the row would simply stop counting. That distinction is the whole
 * rule about clocks in this app — a screen may measure time, and may never
 * decide anything by it.
 */
function useTick(live: boolean): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => setTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [live])
}

/**
 * What the row says.
 *
 * Every reading of it is about a reasoning run that exists, because the row
 * does not exist otherwise. A live one counts up as its deltas land; a
 * finished one says what it took; a replayed one — or one whose whole trace
 * arrived in a single batch — says only "Thought", because one observation is
 * not a duration and a fabricated zero reads as an answer.
 */
function label(live: boolean, seconds: number | null): string {
  if (seconds === null) return live ? 'Thinking' : 'Thought'
  // A running clock says nothing until it has a whole second to say. A
  // duration flashing in the first frame of a run reads as a result rather
  // than as a beginning — it was visible on a real turn, at 101ms.
  if (live) return seconds < 1 ? 'Thinking' : `Thinking for ${formatSeconds(seconds)}`
  return `Thought for ${formatSeconds(seconds)}`
}

function formatSeconds(seconds: number): string {
  if (seconds < 1) return 'a moment'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds / 3600)}h`
}
