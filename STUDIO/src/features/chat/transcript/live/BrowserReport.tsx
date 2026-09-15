import { useState } from 'react'
import { DisclosureRow } from '@/features/chat/transcript/DisclosureRow'
import { useAttachmentFrame } from '@/features/chat/useAttachmentFrame'

import { BrowserCard } from './BrowserCard'
import type { BrowserStep } from './browserCall'
import { BROWSER_FAMILY, type ReportFamily } from './reportFamily'
import type { ToolCallView } from '@/features/chat/transcript/projection'

/**
 * The browser's report, as a box in the transcript.
 *
 * ADR 0049 §7: "An artifact appears in the transcript when the browser starts
 * and updates as it works." This is that box. It exists because the calls
 * were otherwise rows behind a disclosure — a reader had to know the browser
 * was working and open each call to learn anything, which is the difference
 * between watching something happen and auditing a log.
 *
 * What it holds is the segment's browser calls as one story: the newest
 * frame on top, always visible without a click, and each call beneath as a
 * step that expands to the full reading — place, what the tool said, its own
 * frame. Non-browser calls in the same segment keep their ordinary rows and
 * are not this component's business.
 *
 * The steps are the family's `stepOf` output, the same mapping the rail's
 * step list renders; the box and the panel are two sizes of one report, not
 * two readings of the log.
 *
 * The computer's calls (ADR 0055 §7) are the same report under another
 * family: the newest frame of the screen on top, each act a step beneath.
 */
export function BrowserReport({
  calls,
  live,
  conversationId,
  family = BROWSER_FAMILY,
}: {
  calls: readonly ToolCallView[]
  /** This turn is being written now: a call without its answer shimmers. */
  live: boolean
  /** The conversation the calls ran in, which keys their attachments. */
  conversationId: string
  /** Which capability this is a report of. The browser unless said. */
  family?: ReportFamily
}) {
  // Paired, not parallel: a step and the call it came from travel together,
  // so the expanding row never has to trust that two filtered arrays still
  // line up by index.
  const steps: readonly { readonly call: ToolCallView; readonly step: BrowserStep }[] = calls
    .map((call) => {
      const step = family.stepOf(call)
      return step === null ? null : { call, step }
    })
    .filter((entry): entry is { call: ToolCallView; step: BrowserStep } => entry !== null)

  // Newest last in the list, so the newest-first scan here is where the
  // header's facts come from: the latest place the page stood and the latest
  // picture it gave, whichever call most recently carried one.
  const newestFirst = [...steps].reverse()
  const latestFrame = newestFirst.find((entry) => entry.step.frame !== null)?.step.frame ?? null
  const latestUrl = newestFirst.find((entry) => entry.step.url !== null)?.step.url ?? null
  const latestTitle = newestFirst.find((entry) => entry.step.title !== null)?.step.title ?? null
  const frameUrl = useAttachmentFrame(conversationId, latestFrame)

  const running =
    live && calls.some((call) => call.errorText === null && !(call.output !== null && call.output.present))

  return (
    <div className="my-1 flex flex-col gap-2 rounded-md border border-border p-2.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <family.Mark size="sm" className="shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-caption font-medium">{family.label}</span>
        {running ? (
          <span className="studio-shimmer inline-block whitespace-nowrap text-caption text-muted-foreground">
            working
          </span>
        ) : (
          <span className="shrink-0 text-caption text-muted-foreground">
            {steps.length === 1 ? '1 step' : `${steps.length} steps`}
          </span>
        )}
        {latestUrl !== null ? (
          // Not a link, as on every browser surface: the person is watching a
          // model browse, not being handed the page to browse themselves.
          <span className="studio-selectable min-w-0 truncate font-mono text-caption text-muted-foreground">
            {latestUrl}
          </span>
        ) : latestTitle !== null && family.id === 'computer' ? (
          // The computer has no URL; the window it is working in is its place.
          <span className="studio-selectable min-w-0 truncate text-caption text-muted-foreground">
            {latestTitle}
          </span>
        ) : null}
      </div>

      {/* No frame URL is no image element - an attachment still being fetched
          and one the harness cannot produce both read as a report without its
          picture, because a broken-image glyph claims the bytes were here and
          failed to draw, which is never the truth. */}
      {frameUrl === null ? null : (
        <div className="overflow-hidden rounded-md border border-border bg-background">
          <img
            src={frameUrl}
            alt={latestTitle === null ? family.pictureOf : `${latestTitle}, ${family.pictureOf}`}
            className="max-h-[24rem] w-full object-contain object-top"
            draggable={false}
          />
        </div>
      )}

      {steps.length === 0 ? null : (
        <ol className="flex flex-col gap-0.5">
          {/* Newest last: the order it happened in, and the bottom of the
              list is where a reader looks for "now". */}
          {steps.map((entry, index) => (
            <BrowserStepRow
              key={entry.step.id}
              entry={entry}
              ordinal={index + 1}
              conversationId={conversationId}
              family={family}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * One step of the report, expandable to the call's full reading.
 *
 * The closed row is the event in one line — verb, subject, a failed mark
 * where the log carries one. The expansion is the same `BrowserCard` the
 * reader would have seen without the report, so nothing is lost by the
 * grouping: the place, the tool's own words, and the frame that call
 * returned.
 */
function BrowserStepRow({
  entry,
  ordinal,
  conversationId,
  family,
}: {
  entry: { readonly call: ToolCallView; readonly step: BrowserStep }
  ordinal: number
  conversationId: string
  family: ReportFamily
}) {
  const { call, step } = entry
  const [open, setOpen] = useState(false)
  const view =
    call.output !== null && call.output.present
      ? family.read(call.toolName, call.output.value, call.errorText)
      : null
  return (
    <li>
      <DisclosureRow
        entering={false}
        label={
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 tabular-nums text-muted-foreground/70">{ordinal}</span>
            <span className={step.failed ? 'shrink-0 text-danger' : 'shrink-0'}>
              {step.failed ? 'Failed' : step.verb}
            </span>
            {step.subject === null ? null : <span className="truncate">{step.subject}</span>}
          </span>
        }
        open={open}
        onToggle={() => setOpen((value) => !value)}
        // A step with no full reading behind it — a call still running, or
        // one that failed — is a line, not a control: a chevron that opens
        // onto nothing is furniture.
        disabled={view === null}
        chevron="hover"
        flush
      >
        {view === null ? null : (
          <div className="pt-1">
            <BrowserCard call={view} conversationId={conversationId} family={family} />
          </div>
        )}
      </DisclosureRow>
    </li>
  )
}
