import { formatTokens, measuredTotal, type ContextBreakdown } from '@/domain/session/context'
import { cn } from '@/lib/cn'

/**
 * How full the window is, drawn against the model it belongs to.
 *
 * ---- Why this is not a ring in the strip any more --------------------------
 *
 * It was, and the ring had two jobs it could not both do: be a quiet mark you
 * ignore, and be the thing you read when the window is nearly gone. Sitting
 * beside the model pill it was also a second small circle next to the
 * provider's mark, which is one circle too many for a corner that is meant to
 * be a label.
 *
 * The fill belongs where the model is, because that is what it is measured
 * against - a number with no model beside it is a fraction with no
 * denominator. So the whole account lives inside the model's own menu, and the
 * only thing left on the strip is a percentage in the pill's words, and only
 * once it is news.
 *
 * ---- What this may say -----------------------------------------------------
 *
 * Only what something measured. A table itemising the system prompt, the tool
 * definitions, the MCP servers, the skills and the memory files would look
 * more complete and would be mostly invention: no provider reports those, and
 * the harness does not count the sections of the prompt it assembles. What is
 * real is what was sent, how much of it was already cached, what came back,
 * and what the transcript has gained since - and the last of those is an
 * estimate, so it says so on its own row rather than in a footnote.
 *
 * There is no auto-compaction row either, because there is no auto-compaction.
 * When it arrives it takes a reserved band out of the free space, and this is
 * where it will be stated.
 */

interface Band {
  readonly id: string
  readonly label: string
  readonly note: string
  readonly value: number
  readonly className: string
  readonly estimated?: boolean
}

/** Every band the bar draws, in the order it draws them. */
function bandsOf(breakdown: ContextBreakdown): readonly Band[] {
  const measured = breakdown.report.measured
  return [
    ...(measured === null
      ? []
      : [
          {
            id: 'sent',
            label: 'Sent to the model',
            note: 'The conversation and everything the turn carried with it.',
            value: measured.fresh + measured.cached,
            className: 'bg-foreground/55',
          },
          {
            id: 'reply',
            label: 'Reply',
            note: 'What the model produced, reasoning included.',
            value: measured.reply,
            className: 'bg-foreground/30',
          },
        ]),
    {
      id: 'since',
      label: measured === null ? 'This conversation' : 'Since that turn',
      note:
        measured === null
          ? 'Estimated from the transcript. No turn has reported yet.'
          : 'Estimated: the message just sent, and the reply still arriving.',
      value: breakdown.report.pending,
      className: 'bg-foreground/15',
      estimated: true,
    },
  ].filter((band) => band.value > 0)
}

/**
 * The tank: one bar in the window's own proportions, with what is in it and
 * how big it is.
 *
 * The free space is the rest of the track rather than a band of its own, so
 * the eye reads "how much is left" as a length instead of as a subtraction.
 */
export function ContextTank({
  breakdown,
  running,
}: {
  readonly breakdown: ContextBreakdown
  /** A turn is in flight: the bar breathes while the figure is still moving. */
  readonly running: boolean
}) {
  const bands = bandsOf(breakdown)
  const percent = Math.round(breakdown.used * 100)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-caption text-muted-foreground">Context</span>
        <span className="text-caption tabular-nums text-foreground">
          {formatTokens(breakdown.total)}
          <span className="text-muted-foreground">
            {' / '}
            {formatTokens(breakdown.window)} &middot; {percent}%
          </span>
        </span>
      </div>

      <div
        role="meter"
        aria-label="Context used"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn(
          'flex h-2 w-full overflow-hidden rounded-full bg-foreground/10',
          running && 'studio-breathe',
        )}
      >
        {bands.map((band) => (
          <span
            key={band.id}
            className={band.className}
            style={{ width: `${(band.value / breakdown.window) * 100}%` }}
          />
        ))}
      </div>
    </div>
  )
}

/** The itemised account behind the bar, for when the bar is not enough. */
export function ContextDetails({ breakdown }: { readonly breakdown: ContextBreakdown }) {
  const bands = bandsOf(breakdown)
  const measured = breakdown.report.measured

  return (
    <div className="flex flex-col gap-2 pt-1">
      <ul className="flex flex-col gap-2">
        {bands.map((band) => (
          <li key={band.id} className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5 text-caption text-foreground">
                <span className={cn('size-2 shrink-0 rounded-full', band.className)} aria-hidden />
                {band.label}
              </span>
              <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                {band.estimated === true ? '~' : ''}
                {formatTokens(band.value)}
              </span>
            </div>
            <span className="pl-3.5 text-micro text-muted-foreground/80">{band.note}</span>
          </li>
        ))}

        <li className="flex items-baseline justify-between gap-2 border-t pt-2">
          <span className="text-caption text-muted-foreground">Free</span>
          <span className="text-caption tabular-nums text-muted-foreground">
            {formatTokens(breakdown.free)}
          </span>
        </li>
      </ul>

      {measured !== null && measured.cached > 0 ? (
        <p className="text-micro text-muted-foreground/80">
          {formatTokens(measured.cached)} of the{' '}
          {formatTokens(measuredTotal(measured) - measured.reply)} sent came from the cache. It
          occupies the window the same way; it is only cheaper.
        </p>
      ) : null}

      {breakdown.windowDeclared ? null : (
        <p className="text-micro text-muted-foreground/80">
          This model declares no window, so {formatTokens(breakdown.window)} stands in for one.
        </p>
      )}
    </div>
  )
}
