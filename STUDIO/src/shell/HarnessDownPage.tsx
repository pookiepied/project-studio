import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import { StudioMark } from '@/components/brand'
import { Icons } from '@/components/icons'
import { IconStateProvider } from '@/components/icons/Icon'
import { Button, IconButton } from '@/components/primitives'
import { DURATION, EASE_OUT, SHELL } from '@/design/tokens'
import { copyText } from '@/lib/clipboard'
import { harnessFailureReason } from '@/platform/harness'
import { quitApp } from '@/platform/tauri'
import { describeHarnessFailure } from '@/shell/harness-failure'
import { useWorkspace } from '@/stores/workspace'
import { TrafficLights } from '@/shell/chrome/TrafficLights'

/** How long "Copied" stands before the mark returns. Matches `CodeBlock`. */
const COPIED_MS = 1600

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
 * ---- Why the raw text is not the headline ----------------------------------
 *
 * The supervisor writes for a log, and it should keep writing for a log: exit
 * statuses, stderr, `pnpm build`, the path it looked in. That text is the best
 * thing in the world to send to whoever maintains this, and the worst possible
 * greeting. So it stops being the first sentence and becomes the evidence
 * behind "See details" — verbatim, never paraphrased, with the copy button that
 * is the only thing anyone actually wants to do with it.
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
        </div>

        {/* Only when there is something real to show. A disclosure that opens
            onto nothing is a worse answer than no disclosure. */}
        {reason !== null ? <Details reason={reason} /> : null}

        <div className="flex items-center gap-2">
          {/* "Try again", not "Restart the harness". Restart is a lie on the
              common path: the eager start already failed, so for almost
              everyone who reads this button nothing has ever been running and
              there is nothing to re-start. "Try again" is also true on the
              second press, which "Start" would not be, and it says what the
              person wants rather than naming the machinery — the word "harness"
              is already in the headline and the remedy, where it is explained. */}
          <Button variant="secondary" busy={starting} onClick={restart} icon={<Icons.reload />}>
            Try again
          </Button>
          {/* Quit stays. With close-to-tray on, the window's own close means
              hide, so this is the one control on screen that means out — and
              "Quit" is the verb the tray item already uses for it. */}
          <Button variant="ghost" onClick={() => void quitApp()}>
            Quit Studio
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * The supervisor's own words, one press away.
 *
 * ---- Why a disclosure and not a second window ------------------------------
 *
 * Nine times out of ten this is four lines of text. A window to hold four lines
 * is a window to summon, position, read and dismiss, and it takes the person
 * off the page holding the button they came to press. Inline, the evidence sits
 * directly under the claim it supports, which is where evidence belongs.
 *
 * ---- Why there are no line numbers -----------------------------------------
 *
 * Line numbers exist so people can refer to a line: "the bug is on 42". Nobody
 * ever says that about a stderr dump. What people actually do with this text is
 * copy it — into a bug report, a search, a message to whoever maintains this —
 * and numbers actively obstruct that, because select-all either drags them into
 * the paste or forces the column-select nobody gets right. So: monospace,
 * because the alignment in a stack trace is meaning; whitespace preserved, for
 * the same reason; scrollable, because a stderr slab must not push the buttons
 * off screen; and a copy control, because copying is the verb.
 */
function Details({ reason }: { reason: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    // Only on success. A control that says "Copied" when the write was refused
    // is worse than one that does nothing.
    if (!(await copyText(reason))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), COPIED_MS)
  }

  return (
    <div className="flex w-full flex-col items-center" style={{ maxWidth: SHELL.measure }}>
      <IconStateProvider state={open ? 'on' : 'rest'}>
        <Button variant="ghost" size="sm" onClick={() => setOpen((was) => !was)}>
          <Icons.disclosure size="sm" />
          {open ? 'Hide details' : 'See details'}
        </Button>
      </IconStateProvider>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
            className="w-full overflow-hidden"
          >
            <div className="relative mt-2 rounded-lg border bg-surface-sunken text-left">
              <div className="absolute right-1.5 top-1.5">
                <IconButton label={copied ? 'Copied' : 'Copy'} size="sm" onClick={() => void copy()}>
                  {copied ? <Icons.check size="sm" /> : <Icons.copy size="sm" />}
                </IconButton>
              </div>
              {/* `pre`, not a paragraph. A stack trace's indentation is part of
                  what it says, and the right padding clears the copy button so
                  a long first line does not run underneath it. */}
              <pre className="studio-scroll-inset max-h-48 overflow-auto px-3 py-2.5 pr-10 font-mono text-code whitespace-pre-wrap break-words text-muted-foreground">
                {reason}
              </pre>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
