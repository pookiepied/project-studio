import { useEffect, useState } from 'react'

import { Icons } from '@/components/icons'
import { Button, IconButton } from '@/components/primitives'
import { SHELL } from '@/design/tokens'
import { copyText } from '@/lib/clipboard'
import { harnessFailureReason } from '@/platform/harness'
import { closeWindow } from '@/platform/tauri'
import { describeHarnessFailure } from '@/shell/harness-failure'
import { TrafficLights } from '@/shell/chrome/TrafficLights'

/** How long "Copied" stands before the mark returns. Matches `CodeBlock`. */
const COPIED_MS = 1600

/**
 * The harness failure, at full size, in its own window.
 *
 * ---- Why a window ----------------------------------------------------------
 *
 * Because this text is a document, and documents get windows. The supervisor
 * keeps up to fifty lines of what it saw before the failure plus the child's
 * entire stdout and stderr, so for a crash with a Node stack trace this is
 * routinely dozens of lines, not the handful an inline disclosure was built
 * for. Inline it had two ways to go and both were bad: grow, and push the
 * page's own buttons around under the reader; or cap and scroll, and put a
 * scrollbar inside a centred page, which is the density this app exists to
 * avoid. A window can be resized to the text, kept open beside the app while
 * the cause is being fixed, and scrolled without moving anything else.
 *
 * It asks the supervisor for the failure itself rather than being handed it.
 * Nothing to plumb, no copy to go stale, and no payload that could carry a
 * token between windows.
 *
 * ---- Why the line numbers are safe here ------------------------------------
 *
 * Numbers were the wrong answer inside the page and are the right one here,
 * and the difference is the gutter. The objection to them was never
 * decorative: what people actually do with an error is copy it, and numbers
 * woven into the text mean select-all produces a paste with a number welded to
 * the front of every line. A real gutter is a separate element carrying
 * `user-select: none`, so a selection that crosses it takes the code and
 * leaves the numbers behind -- the same trick every code viewer uses, and the
 * reason they can offer numbers without ruining copy. With that in place the
 * numbers earn their keep: they turn "it failed somewhere in here" into
 * something two people can talk about over a distance.
 */
export function DiagnosticWindow() {
  const [reason, setReason] = useState<string | null>(null)
  const [read, setRead] = useState(false)

  useEffect(() => {
    let live = true
    void harnessFailureReason().then((found) => {
      if (!live) return
      setReason(found)
      setRead(true)
    })
    return () => {
      live = false
    }
  }, [])

  const failure = describeHarnessFailure(reason)

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden border border-hairline bg-surface"
      style={{ borderRadius: SHELL.windowRadius }}
    >
      <header
        data-tauri-drag-region
        className="flex shrink-0 items-center justify-between gap-3 border-b"
        style={{ height: SHELL.topStrip.height, paddingInline: SHELL.topStrip.paddingInline }}
      >
        <TrafficLights />
        {/* The code, in the title bar, in the monospace face. It is an
            identifier rather than a sentence, and setting it in the UI face
            beside the prose is what makes people read it as prose and skim
            past the one thing here they can search for. */}
        <span className="pointer-events-none truncate font-mono text-code text-muted-foreground">
          {failure.code}
        </span>
        <Button variant="ghost" size="sm" onClick={() => void closeWindow()}>
          Close
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div>
          <h1 className="text-title text-foreground">{failure.headline}</h1>
          {failure.remedy !== null ? (
            <p className="mt-1 text-ui text-muted-foreground">{failure.remedy}</p>
          ) : null}
        </div>

        {!read ? null : reason === null ? (
          // The supervisor is holding no sentence. Almost always this window
          // outlived the failure it was opened for -- someone pressed Try
          // again in the other window and it worked.
          <p className="text-ui text-muted-foreground">
            The supervisor is not reporting a failure. It may have started since this window
            was opened.
          </p>
        ) : (
          <LogView text={reason} />
        )}
      </div>
    </div>
  )
}

/**
 * The supervisor's output, numbered, monospaced, and copyable.
 *
 * The numbers live in their own column with `select-none` on it, so copying
 * takes the text and leaves them behind. Lines do not wrap: wrapping breaks
 * the one-number-per-line correspondence the gutter is built on, and log lines
 * are wide because they are meant to be scanned horizontally rather than read
 * as paragraphs. The pane scrolls in both directions instead, which in a
 * window is what scrolling is for.
 */
function LogView({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  // No trailing blank line from a final newline: a numbered empty row at the
  // bottom reads as output that is still arriving.
  const lines = text.replace(/\n+$/, '').split('\n')

  const copy = async () => {
    // Only on success. A control that says "Copied" when the write was refused
    // is worse than one that does nothing.
    if (!(await copyText(text))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), COPIED_MS)
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-code-surface">
      <div className="absolute right-1.5 top-1.5 z-10">
        <IconButton label={copied ? 'Copied' : 'Copy'} size="sm" onClick={() => void copy()}>
          {copied ? <Icons.check size="sm" /> : <Icons.copy size="sm" />}
        </IconButton>
      </div>

      <div className="studio-scroll-inset h-full overflow-auto py-2">
        <table className="w-full border-separate border-spacing-0 font-mono text-code">
          <tbody>
            {lines.map((line, index) => (
              // The index is the identity here, and legitimately so: this is a
              // fixed snapshot of text that never reorders or splices.
              <tr key={index}>
                <td
                  className="sticky left-0 select-none bg-code-surface pr-3 pl-3 text-right align-top text-muted-foreground/50"
                  // Sticky so the numbers stay put while a long line is
                  // scrolled sideways, which is the whole reason to keep them
                  // in a column rather than a prefix.
                >
                  {index + 1}
                </td>
                <td className="pr-10 align-top whitespace-pre text-foreground/85">
                  {/* A space for an empty line, so its row keeps its height and
                      the numbers stay level with the text beside them. */}
                  {line === '' ? ' ' : line}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
