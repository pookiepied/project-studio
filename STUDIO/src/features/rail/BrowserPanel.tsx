import { useState } from 'react'
import { cn } from '@/lib/cn'
import { useWorkspace } from '@/stores/workspace'
import { useAttachmentFrame } from '@/features/chat/useAttachmentFrame'
import type { BrowserStep } from '@/features/chat/transcript/live/browserCall'
import { familyById, type ReportFamily } from '@/features/chat/transcript/live/reportFamily'
import type { RailEntry } from '@/stores/rail'
import { openBrowserWindow } from '@/platform/tauri'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives/IconButton/IconButton'

/**
 * The browser preview, at a size worth looking at.
 *
 * The transcript row shows the report inline because a reader following the
 * work wants to see it happen. This is the same report with room around it,
 * for when somebody actually wants to *look* — at a layout, at a font, at
 * whether the mobile breakpoint did what it was supposed to do.
 *
 * **It is a preview and not a browser** (ADR 0049 §7). No address bar, no back
 * button, nothing clickable. Those need history, cookie and profile
 * management, a download policy and a clear-data control, which is a second
 * product inside this one — built for a person who has a real browser one
 * keystroke away. What is here instead is the sequence: where the page is,
 * what the model has done to it, and the picture any step brought back.
 *
 * ---- The frame on top is a choice, not a default ---------------------------
 *
 * The picture shown is the selected step's — the newest one until a hand
 * picks another. The entry holds the sequence, so the rail can answer "what
 * did it look like *then*" and not only "what does it look like now", which
 * is the one question a single latest frame cannot. Nothing here builds a
 * `data:` URL of its own: frames arrive as the log carries them (an
 * attachment reference, usually) and resolve through the same hook the
 * transcript uses, so a picture is either truly present or truly absent —
 * never a broken glyph claiming bytes that are not here.
 *
 * The computer's preview (ADR 0055 §7) is this panel under its own family:
 * the frame is the screen, the place is the window being worked in, and the
 * stop ends the driver.
 */
export function BrowserPanel({
  entry,
}: {
  entry: Extract<RailEntry, { kind: 'browser' }>
}) {
  // The newest step with something to show, which is where a reader's eye
  // starts: "now" is what they came to see. A list walked backwards once beats
  // a state initialiser racing an entry that replaces itself mid-render.
  const latest = latestStepId(entry.steps)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const selected =
    entry.steps.find((step) => step.id === (selectedId ?? latest)) ?? null
  const family = familyById(entry.family)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">
            {entry.title === null || entry.title === '' ? family.nowhere : entry.title}
          </span>
          {entry.url === null ? null : (
            // Deliberately not a link. Following it would open the page in the
            // person's real browser, with their real cookies — a different act
            // from the one they are watching, and one they did not ask for.
            <span className="studio-selectable truncate font-mono text-code text-muted-foreground">
              {entry.url}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {entry.recorded || family.id !== 'browser' ? null : (
            <IconButton label="Open browser in new window" onClick={() => {
              setOpenError(null)
              void openBrowserWindow(entry.conversationId).catch(() => setOpenError('The browser window could not open. Try again.'))
            }}><Icons.openExternal /></IconButton>
          )}
          {entry.recorded ? null : <StopBrowser conversationId={entry.conversationId} family={family} />}
        </div>
      </div>
      {openError ? <p role="alert" className="text-caption text-muted-foreground">{openError}</p> : null}

      <BrowserFrameView
        conversationId={entry.conversationId}
        step={selected}
        title={entry.title}
        family={family}
        recorded={entry.recorded === true}
      />

      {entry.steps.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">What happened</span>
          <ol className="flex flex-col gap-0.5">
            {/* Newest last, because that is the order it happened in and the
                bottom of a list is where a reader looks for "now". */}
            {entry.steps.map((step, index) => (
              <BrowserPanelStep
                key={step.id}
                step={step}
                ordinal={index + 1}
                selected={selected?.id === step.id}
                hasFrame={step.frame !== null}
                onSelect={() => setSelectedId(step.id)}
              />
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

/**
 * The person's stop for this conversation's browser (ADR 0049 §4).
 *
 * The browser is a process a person could otherwise only find in a task
 * manager; this is the place in Studio where it can be found and ended. The
 * panel does not know whether one is running - that is the server's to know,
 * and asking on every render would be a poll for a button - so the button is
 * always here, and the answer says what happened: "Stopped" when a browser
 * was running, "Not running" when there was nothing to stop. Both settle
 * back to the button after a moment, so a second press is possible.
 */
function StopBrowser({ conversationId, family }: { conversationId: string; family: ReportFamily }) {
  const { browser, computer } = useWorkspace()
  const [state, setState] = useState<'idle' | 'busy' | 'stopped' | 'unconfirmed' | 'nothing'>('idle')

  const stop = async () => {
    setState('busy')
    if (family.id === 'computer') {
      // The computer says which of its outcomes it came to; an unconfirmed
      // cleanup is neither "stopped" nor "not running".
      const result = await computer.stop(conversationId)
      setState(!result.ok ? 'nothing' : result.value === 'cleanup_confirmed' ? 'stopped' : result.value === 'cleanup_unconfirmed' ? 'unconfirmed' : 'nothing')
    } else {
      const result = await browser.stop(conversationId)
      setState(result.ok && result.value ? 'stopped' : 'nothing')
    }
    setTimeout(() => setState('idle'), 2000)
  }

  if (state === 'stopped' || state === 'unconfirmed' || state === 'nothing') {
    return (
      <span className="shrink-0 text-micro text-muted-foreground" role="status">
        {state === 'stopped' ? 'Stopped' : state === 'unconfirmed' ? 'Stop sent, not confirmed' : 'Not running'}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => void stop()}
      disabled={state === 'busy'}
      aria-label={`Stop ${family.label.toLowerCase()}`}
      className={cn(
        'shrink-0 rounded-md px-1.5 py-0.5 text-micro',
        'text-muted-foreground transition-colors duration-fast',
        'hover:bg-tint hover:text-foreground disabled:opacity-50',
      )}
    >
      Stop
    </button>
  )
}

/**
 * The id of the newest step whose frame a reader could look at, or null.
 *
 * A failed step's frame is the log saying there is none, so it never becomes
 * the default; a step still running has not produced one either. The scan
 * takes the newest *answer*, which is the picture the page actually stood in
 * most recently.
 */
function latestStepId(steps: readonly BrowserStep[]): string | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step !== undefined && step.frame !== null) return step.id
  }
  return null
}

/**
 * The step's picture, or the sentence that says why there is none.
 *
 * Three absences, and they are not the same absence: no picture yet (the
 * browser has not sent one), a step still working (its answer has not
 * landed), and a selected step that brought no frame (a click, a read —
 * actions that do not photograph the page). Naming the difference is the
 * whole job; a single "no image" would be wrong about two of the three.
 * The one line this cannot improve on is an attachment reference that has
 * not resolved — the resolver answers null for both "in flight" and "asked
 * and refused", and the sentence below is the one that stays true across
 * both.
 */
function BrowserFrameView({
  conversationId,
  step,
  title,
  family,
  recorded,
}: {
  conversationId: string
  step: BrowserStep | null
  title: string | null
  family: ReportFamily
  recorded: boolean
}) {
  const frameUrl = useAttachmentFrame(conversationId, step?.frame ?? null)
  if (step === null) {
    return (
      <p className="text-caption text-muted-foreground">
        {recorded ? 'No screenshot was recorded for this website.' : family.id === 'computer'
          ? 'No picture of the screen yet.'
          : 'The browser has not sent a picture yet.'}
      </p>
    )
  }
  if (frameUrl === null) {
    return (
      <p className="text-caption text-muted-foreground">
        {step.frame === null
          ? 'This step brought no picture.'
          : step.failed
            ? 'This step failed, and brought no picture.'
            : 'The picture has not arrived yet.'}
      </p>
    )
  }
  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <img
        src={frameUrl}
        alt={title === null ? family.pictureOf : `${title}, ${family.pictureOf}`}
        className="w-full object-contain object-top"
        draggable={false}
      />
    </div>
  )
}

/**
 * One line of the sequence, and the handle that points the frame above at
 * it.
 *
 * A step that returned a picture is the selectable kind: pressing it shows
 * that step's frame, which is the panel's answer to "what did it look like
 * when it did this". A step without one stays a line — selectable furniture
 * that changes nothing is a lie told twice per click.
 */
function BrowserPanelStep({
  step,
  ordinal,
  selected,
  hasFrame,
  onSelect,
}: {
  step: BrowserStep
  ordinal: number
  selected: boolean
  hasFrame: boolean
  onSelect: () => void
}) {
  const line = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 tabular-nums text-muted-foreground/70">{ordinal}</span>
      <span className={cn('shrink-0', step.failed && 'text-danger')}>
        {step.failed ? 'failed' : step.verb}
      </span>
      {step.subject === null ? null : (
        <span className="truncate">{step.subject}</span>
      )}
    </span>
  )
  if (!hasFrame) {
    return (
      <li className="studio-selectable text-caption text-muted-foreground">{line}</li>
    )
  }
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          'flex w-full items-center rounded-md pr-1.5 py-0.5 text-left text-caption transition-colors duration-fast',
          selected
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {line}
      </button>
    </li>
  )
}
