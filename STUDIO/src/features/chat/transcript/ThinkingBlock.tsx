import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Icons } from '@/components/icons'
import { Dialog } from '@/components/primitives/Dialog/Dialog'
import { ENTER } from '@/design/tokens'
import { cn } from '@/lib/cn'

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
 * ---- Where the trace lives now ---------------------------------------------
 *
 * It used to disclose inline: expanding hung the working-out in the reading
 * column behind a rule, and a long run made that column unbounded — the reply
 * reflowed around a wall of notes, the answer fell below the fold, and reading
 * the trace meant scrolling inside the transcript to reach text nobody is
 * here for. The trace now opens into the sheet instead: the house modal, a
 * bounded surface with its own scroll, drawn over the conversation and closed
 * without moving anything beneath it. The reply keeps its shape; the
 * working-out gets a room of its own, which is also where a trace this long
 * always wanted to be read — top to bottom in one place, not interleaved with
 * the answer it was separate from.
 *
 * The row is therefore no longer a disclosure. A disclosure promises a region
 * beneath the row, and there is none; promising one would rotate a chevron
 * over an expansion that never comes. The row keeps the geometry every
 * secondary row of a reply shares — the mark flush at the content boundary,
 * the same paddings, see `DisclosureRow` — and the chevron rests pointing at
 * the sheet it opens, which is the Apple reading of that mark: it navigates
 * rather than expands. `aria-haspopup` names what the press produces.
 *
 * Opened while the run is still producing, the sheet follows the stream —
 * pinned to the newest line until the reader scrolls up, following again when
 * they return. A trace read after the fact opens at its first line instead.
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
  const [sheetOpen, setSheetOpen] = useState(false)
  useTick(live)
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
    // The row wrapper carries the house entrance itself: `DisclosureRow` used
    // to own it, and the row it drew was this row — the entrance moves with
    // the row, not with the surface the row opens.
    <motion.div
      className="mb-2.5"
      initial={live ? ENTER.initial : false}
      animate={ENTER.animate}
      transition={ENTER.transition}
    >
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        disabled={trace === null}
        {...(trace === null ? {} : { 'aria-haspopup': 'dialog' })}
        className={cn(
          // The geometry is DisclosureRow's row: first painted element flush at
          // the content boundary, padding on the right only extending the press
          // target. Two shapes of secondary row that disagree by four pixels
          // read as an indent nobody chose.
          'group/thinking inline-flex max-w-full items-center gap-1.5 rounded-md py-0.5 pr-1.5 text-left',
          'text-caption text-muted-foreground transition-colors duration-fast',
          trace === null ? 'cursor-default' : 'hover:text-foreground',
        )}
      >
        <Icons.thinking />
        {shown}
        {trace === null ? null : (
          <Icons.disclosure
            // `hover` affordance: the row's job at rest is to be read past, so
            // the mark that promises a surface appears over the row and on
            // keyboard focus. It never turns — nothing expands beneath it.
            className="opacity-0 transition-opacity duration-fast group-hover/thinking:opacity-100 group-focus-visible/thinking:opacity-100"
          />
        )}
      </button>

      <TraceSheet open={sheetOpen} onClose={() => setSheetOpen(false)} trace={trace} live={live} />
    </motion.div>
  )
}

/**
 * The trace's own surface, and the two scroll behaviours it owes.
 *
 * Opened at the end of a run it opens at the first line, like any document.
 * Opened mid-run it opens at the newest line — the reader pressed it to watch
 * the model work, and the bottom of the trace is where the work is — and it
 * follows the stream until the reader scrolls away from the end. That last
 * rule is the whole art of a following pane: text arriving must not drag a
 * reader who has scrolled back to check an earlier step, and a reader who
 * returns to the bottom gets the live view back. The threshold is a line's
 * height, not zero, so a half-pixel rounding does not read as intent.
 */
function TraceSheet({
  open,
  onClose,
  trace,
  live,
}: {
  open: boolean
  onClose: () => void
  trace: string | null
  live: boolean
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(false)

  useEffect(() => {
    if (!open) {
      pinned.current = false
      return
    }
    const el = scroller.current
    if (live && el !== null) el.scrollTop = el.scrollHeight
  }, [open, live])

  useEffect(() => {
    const el = scroller.current
    if (!open || !pinned.current || el === null) return
    el.scrollTop = el.scrollHeight
  }, [trace, open])

  if (trace === null) return null

  return (
    <Dialog open={open} onClose={onClose} title="Reasoning" width="30rem">
      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current
          if (el === null) return
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="max-h-[60vh] overflow-y-auto"
      >
        {/* The trace is prose-grade plain text at the caption register — the
            same treatment the inline body wore, moved rather than redrawn. */}
        <div className="studio-selectable text-caption whitespace-pre-wrap text-muted-foreground">
          {trace}
        </div>
      </div>
    </Dialog>
  )
}

/**
 * How this row knows how long the thinking took: two moments this window
 * recorded, and a duration derived from them. Never a number handed in from
 * elsewhere — the gallery used to state one, and a stated zero and a
 * measured zero meant the same thing on screen. A span with no start is a
 * run nothing here observed, and the row says only "Thought".
 */
export interface ThinkingSpan {
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
