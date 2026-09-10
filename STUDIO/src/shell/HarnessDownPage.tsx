import { useEffect, useState } from 'react'

import { StudioMark } from '@/components/brand'
import { Icons } from '@/components/icons'
import { Button } from '@/components/primitives'
import { SHELL } from '@/design/tokens'
import { harnessFailureReason } from '@/platform/harness'
import { isTauri, openDiagnosticWindow, quitApp } from '@/platform/tauri'
import { describeHarnessFailure } from '@/shell/harness-failure'
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
 * ---- What it says ----------------------------------------------------------
 *
 * The headline is the classified failure, not a fixed sentence, because the
 * fixed one could only ever describe the absence and never the cause. Under it
 * the remedy, and under that the raw supervisor text behind a disclosure.
 *
 * This page used to carry a line explaining that conversations live in the
 * harness "so there is nothing to read and nowhere to send". It was written for
 * someone who lost the harness mid-work, and that is not who arrives here: the
 * eager start fails before any window exists, so the overwhelmingly common way
 * to see this page is to open Studio and have it be the first thing there. To
 * that person the sentence describes a loss they never experienced and implies
 * they were reaching for something they had not asked for yet. It is gone. The
 * classified remedy explains what the harness is where explaining it is
 * actually useful — in the same breath as what to do about it.
 *
 * ---- Why the raw text is not here at all -----------------------------------
 *
 * The supervisor writes for a log, and it should keep writing for a log: exit
 * statuses, stderr, `pnpm build`, the path it looked in. That text is the best
 * thing in the world to send to whoever maintains this, and the worst possible
 * greeting.
 *
 * It briefly lived here behind an inline disclosure, and that was wrong on the
 * facts: the supervisor keeps up to fifty observed lines plus the child's whole
 * stdout and stderr, so a crash is routinely dozens of lines rather than the
 * handful the box was sized for. An inline block that size either grows and
 * shoves these buttons around under the reader, or caps and scrolls, which puts
 * a scrollbar inside a centred page. So the page keeps the code -- the one
 * short thing worth quoting -- and the text itself gets a window
 * (`DiagnosticWindow`), where it can be resized to, scrolled, and left open
 * while the cause is fixed.
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

  const failure = describeHarnessFailure(reason)

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
        {/* The mark does not breathe here. `busy` is the ripple that means work
            is in flight, and nothing is in flight on this page — the harness is
            down and stays down until someone presses. A mark pulsing over a
            stopped engine reads as "still trying", which is the one thing this
            page must not imply. `entrance` instead: assembles once, then holds. */}
        <StudioMark entrance size={44} className="text-foreground" />

        <div className="flex flex-col items-center" style={{ maxWidth: SHELL.measure }}>
          <h1 className="studio-display text-foreground">{failure.headline}</h1>
          {failure.remedy !== null ? (
            <p className="mt-3 text-ui text-muted-foreground">{failure.remedy}</p>
          ) : null}
          {/* The code, under the prose, in the monospace face so it reads as an
              identifier rather than as the end of the sentence above it. It is
              the one thing on this page worth writing down, and the only part
              of the failure that is stable enough to search for. */}
          {reason !== null ? (
            <p className="mt-3 font-mono text-code text-muted-foreground/70">{failure.code}</p>
          ) : null}
        </div>

        {/* Only offered when there is something to show. A control that opens a
            window onto nothing is worse than no control. */}
        {reason !== null ? (
          <Button variant="ghost" size="sm" onClick={() => void openDiagnosticWindow()}>
            <Icons.openExternal size="sm" />
            See details
          </Button>
        ) : null}

        <div className="flex items-center gap-2">
          {/* `sm`, like every other real action in the app. These were `md`,
              which is a size nothing else uses: settings, dialogs and rows are
              all `sm`, so two `md` buttons alone on a page did not read as
              emphasis, they read as a different app. */}
          <Button variant="secondary" size="sm" busy={starting} onClick={restart} icon={<Icons.reload />}>
            Start the harness
          </Button>
          {/* Named for what it does, which is start the harness and nothing
              else -- `ensureStore` asks the supervisor to bring it up and then
              re-reads the index. It does not restart Studio, and "Try again"
              left that open to being read either way. This is also the label
              the chat notice already uses for the same action, so the app has
              one name for it.

              Quit is the desktop app's life ending, and a browser tab is not
              that life (plan step 6): a paired device pressing it would be
              asking the PC's Studio to disappear from a room it is not
              sitting in, so the button exists only where the app does. */}
          {isTauri() && (
            <Button variant="ghost" size="sm" onClick={() => void quitApp()}>
              Quit Studio
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
