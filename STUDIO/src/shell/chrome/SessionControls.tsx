import { useState } from 'react'
import { Popover } from '@/components/primitives'
import { measuredTotal, type ContextBreakdown } from '@/domain/session/context'
import { cn } from '@/lib/cn'

/**
 * The context meter: a ring in the strip, and the whole account behind it.
 *
 * ---- Present, but quiet ---------------------------------------------------
 *
 * It used to draw nothing below 60%, on the argument that a meter always on
 * screen is a number the user is invited to watch, and watching it is never
 * the work. The argument was right about the NUMBER and wrong about the ring:
 * a meter that is absent most of the time cannot be found when you go looking
 * for it, and this one was absent always - it was reading a `messages` array
 * that is empty for every live conversation, so it never once appeared.
 *
 * So the ring is always there on a conversation, the figure is in the panel
 * whenever you want it, and the percentage only prints itself beside the ring
 * at 60% - early enough to change what you do next, late enough to be news.
 *
 * ---- What the panel may say -----------------------------------------------
 *
 * Only what something measured. A panel itemising the system prompt, the tool
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
 *
 * ---- Why it also carries the run ------------------------------------------
 *
 * While a turn runs the ring turns with it, beside a title wearing the same
 * shimmer the transcript puts on a running tool row. It is not REPORTING the
 * run - the title is - it is moving in sympathy so the strip has one live
 * thing rather than two competing ones.
 */
export function ContextMeter({
  breakdown,
  running,
  modelName,
}: {
  readonly breakdown: ContextBreakdown
  /** A turn is in flight: the ring turns until it settles. */
  readonly running: boolean
  /** The model the window belongs to, named in the panel. Null when none is. */
  readonly modelName: string | null
}) {
  const [open, setOpen] = useState(false)
  const radius = 5
  const circumference = 2 * Math.PI * radius
  const percent = Math.round(breakdown.used * 100)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      className="w-[19rem] max-w-[19rem] p-3"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Context: ${percent}% of the window used`}
          className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-caption text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground"
        >
          <svg
            viewBox="0 0 14 14"
            className={cn('size-3.5 -rotate-90', running && 'studio-spin')}
            aria-hidden
          >
            <circle
              cx="7"
              cy="7"
              r={radius}
              fill="none"
              strokeWidth="2"
              className="stroke-foreground/15"
            />
            <circle
              cx="7"
              cy="7"
              r={radius}
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              className="stroke-foreground/55"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - breakdown.used)}
            />
          </svg>
          {percent >= 60 ? `${percent}%` : null}
        </button>
      }
    >
      <ContextPanel breakdown={breakdown} modelName={modelName} />
    </Popover>
  )
}

/** Thousands separated, because these numbers are read, not calculated with. */
function tokens(value: number): string {
  return value.toLocaleString()
}

interface Band {
  readonly id: string
  readonly label: string
  readonly note: string
  readonly value: number
  readonly className: string
  readonly estimated?: boolean
}

function ContextPanel({
  breakdown,
  modelName,
}: {
  readonly breakdown: ContextBreakdown
  readonly modelName: string | null
}) {
  const { report, window: size, windowDeclared, total, free } = breakdown
  const measured = report.measured

  // Every band the bar draws, in the order it draws them, so the bar and the
  // list below it cannot disagree about what is in the window.
  const bands: readonly Band[] = [
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
      value: report.pending,
      className: 'bg-foreground/15',
      estimated: true,
    },
  ].filter((band) => band.value > 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-ui text-foreground">Context</span>
          <span className="text-caption tabular-nums text-muted-foreground">
            {tokens(total)} / {tokens(size)}
          </span>
        </div>

        {/* One bar, in the window's own proportions: the free space is the
            rest of the track rather than a band of its own, so the eye reads
            "how much is left" as a length instead of as a number to subtract. */}
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
          {bands.map((band) => (
            <span
              key={band.id}
              className={band.className}
              style={{ width: `${(band.value / size) * 100}%` }}
            />
          ))}
        </div>
      </div>

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
                {tokens(band.value)}
              </span>
            </div>
            <span className="pl-3.5 text-micro text-muted-foreground/80">{band.note}</span>
          </li>
        ))}

        <li className="flex items-baseline justify-between gap-2 border-t pt-2">
          <span className="text-caption text-muted-foreground">Free</span>
          <span className="text-caption tabular-nums text-muted-foreground">{tokens(free)}</span>
        </li>
      </ul>

      {measured !== null && measured.cached > 0 ? (
        <p className="text-micro text-muted-foreground/80">
          {tokens(measured.cached)} of the {tokens(measuredTotal(measured) - measured.reply)} sent
          came from the cache. It occupies the window the same way; it is only cheaper.
        </p>
      ) : null}

      <p className="text-micro text-muted-foreground/80">
        {windowDeclared
          ? `Measured against the window ${modelName ?? 'the selected model'} declares.`
          : `${modelName ?? 'The selected model'} declares no window, so ${tokens(size)} stands in for one.`}
      </p>
    </div>
  )
}
