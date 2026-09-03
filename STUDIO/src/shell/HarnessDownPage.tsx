import { useEffect, useState } from 'react'

import { StudioMark } from '@/components/brand'
import { Icons } from '@/components/icons'
import { Button } from '@/components/primitives'
import { SHELL } from '@/design/tokens'
import { harnessFailureReason } from '@/platform/harness'
import { quitApp } from '@/platform/tauri'
import { useWorkspace } from '@/stores/workspace'
import { TrafficLights } from '@/shell/chrome/TrafficLights'

/**
 * The page that is the whole window while the harness is down.
 *
 * ---- Why the shell is not behind it ----------------------------------------
 *
 * The harness is not a feature of the studio; it is the thing the studio runs
 * on — the conversation index, the catalog, every send. With it down there is
 * no sidebar worth listing and no composer worth typing into, so this page
 * does not sit beside any of that: it replaces it. No sidebar, no rail, no
 * route — one page, the way an error page on the web is one page. What stays
 * is the window itself: the traffic lights remain, because close, minimize
 * and zoom belong to the window, not to the app that is missing its engine.
 *
 * ---- The shape of it -------------------------------------------------------
 *
 * A 404 page is the honest genre here: the thing you asked for is not there,
 * the page says so in the typeface the app is own voice in, and gives you the
 * actions that still exist. So: the mark, arriving once and then still — the
 * statement in the display serif, one sentence of why, the supervisor's
 * verbatim reason where it has one, and two real actions. "Restart the
 * harness" because that is what the button does; the supervisor is
 * single-flight, so pressing it again joins a start already in flight. "Quit
 * Studio" because with close-to-tray enabled the window's own close button
 * means hide, and a page with no shell still owes a person a way out that
 * means out.
 *
 * The mark does not breathe here. `busy` is the ripple that means work is in
 * flight, and nothing is in flight on this page — the harness is down and
 * stays down until someone presses. A mark pulsing over a stopped engine says
 * "still trying", which is the one thing this page must not imply. `entrance`
 * instead: the tiles assemble once on arrival and then hold.
 *
 * The reason is fetched on mount — an eager start fails before any window
 * exists, which is the common way to arrive here — and after every refused
 * press, verbatim and redacted at its source. "Why will it not start" is the
 * first question anyone asks, and the page was built to answer it.
 */
export function HarnessDownPage() {
  const { ensureStore } = useWorkspace()
  const [starting, setStarting] = useState(false)
  const [reason, setReason] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void harnessFailureReason().then((found) => {
      if (live) setReason(found)
    })
    return () => {
      live = false
    }
  }, [])

  const restart = () => {
    setStarting(true)
    setReason(null)
    void ensureStore()
      .then((up) => {
        // Up means the harness answered and the shell is coming back; the
        // page unmounts underneath this callback. Refused means the
        // supervisor kept a sentence, and the page fetches it rather than
        // leaving a second press to repeat the first silence.
        if (up) return undefined
        return harnessFailureReason().then((found) => {
          setReason(found)
        })
      })
      .finally(() => {
        setStarting(false)
      })
  }

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden border border-hairline bg-surface"
      style={{ borderRadius: SHELL.windowRadius }}
    >
      {/* The window, and only the window: controls and the drag they sit in.
          Nothing else in the strip — a sidebar toggle over a page with no
          sidebar would be a promise about a room that is not there. */}
      <header
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 z-10 flex items-center"
        style={{ height: SHELL.topStrip.height, paddingInline: SHELL.topStrip.paddingInline }}
      >
        <TrafficLights />
      </header>

      <div
        className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center"
        style={{ paddingInline: SHELL.gutter }}
      >
        <StudioMark entrance size={44} className="text-foreground" />

        <div className="flex flex-col items-center" style={{ maxWidth: SHELL.measure }}>
          <h1 className="studio-display text-foreground">The harness is not running.</h1>
          <p className="mt-3 text-ui text-muted-foreground">
            Conversations live in the harness, so there is nothing to read and
            nowhere to send until it starts.
          </p>
        </div>

        {reason !== null ? (
          <div
            role="note"
            className="flex w-full max-w-[60ch] items-start gap-2 rounded-lg border bg-surface-raised p-3 text-left text-caption text-muted-foreground"
          >
            <Icons.failed size="sm" className="mt-0.5 shrink-0" />
            {/* Verbatim from the supervisor, redacted at its source. Long on
                purpose: this text is the diagnostic, and trimming it here
                would send the next reader to a log file. */}
            <span className="max-h-40 overflow-y-auto break-words studio-scroll-inset">
              {reason}
            </span>
          </div>
        ) : null}

        {/* `md`, not `lg`. Studio's window is small by design, and the large
            size exists for a page that is mostly empty space — here the two
            controls sat under a heading and a paragraph they then out-measured,
            so the page read as a dialog with oversized buttons rather than as
            a page. `md` is the size every other real action in the app is, and
            these are not more important than those. */}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            busy={starting}
            onClick={restart}
            icon={<Icons.reload />}
          >
            Restart the harness
          </Button>
          <Button variant="ghost" onClick={() => void quitApp()}>
            Quit Studio
          </Button>
        </div>
      </div>
    </div>
  )
}
