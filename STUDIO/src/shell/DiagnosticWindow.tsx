import { useEffect, useState } from 'react'

import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { SHELL } from '@/design/tokens'
import { copyText } from '@/lib/clipboard'
import { harnessFailureReason } from '@/platform/harness'
import { describeHarnessFailure } from '@/shell/harness-failure'
import { TrafficLights } from '@/shell/chrome/TrafficLights'

/** How long "Copied" stands before the mark returns. Matches `CodeBlock`. */
const COPIED_MS = 1600

/**
 * The harness failure, at full size, in its own window.
 *
 * ---- What this window is ---------------------------------------------------
 *
 * A read-only text editor showing one file, and nothing else. Not a page about
 * an error: the page states the error, and it is still on screen behind this.
 * Repeating the headline and the remedy here made this a second, worse copy of
 * that page with a log stapled underneath.
 *
 * So the whole window is the text. A title bar carrying the window controls,
 * the name of what is being shown, and one action -- copy -- and below it the
 * file. There is no Close button in the content, because the traffic lights in
 * the corner are the close button; shipping both asks the same question twice
 * and answers it in two places.
 *
 * ---- Why a window at all ---------------------------------------------------
 *
 * The supervisor keeps up to fifty lines of what it saw before the failure
 * plus the child's entire stdout and stderr, so a crash is routinely dozens of
 * lines. Inline that either grows and pushes the page's own buttons around
 * under the reader, or caps and scrolls, which puts a scrollbar inside a
 * centred page. A window can be resized to the text and scrolled without
 * moving anything else.
 *
 * It asks the supervisor for the failure itself rather than being handed it.
 * Nothing to plumb, no copy to go stale, and no payload that could carry a
 * token between windows.
 *
 * ---- Why the line numbers are safe -----------------------------------------
 *
 * The gutter is a separate column carrying `user-select: none`, so a selection
 * that crosses it takes the text and leaves the numbers behind. That is the
 * trick every code viewer uses, and it is the reason numbers can be offered at
 * all: woven into the text, they would turn every paste into a mess.
 *
 * ---- The window label ------------------------------------------------------
 *
 * Built as `diagnostic-harness`, which must stay covered by the `diagnostic-*`
 * entry in `capabilities/default.json`. Unlisted, this window silently loses
 * both its window controls and `store:allow-load` -- which is not a crash but
 * a wrong-looking window, because `loadAppearance` then falls through to the
 * shipped default and opens in the system colour scheme while the rest of the
 * app sits in the theme the user chose.
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
      className="flex h-full w-full flex-col overflow-hidden border border-hairline bg-surface"
      style={{ borderRadius: SHELL.windowRadius }}
    >
      <header
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-3 border-b"
        style={{ height: SHELL.topStrip.height, paddingInline: SHELL.topStrip.paddingInline }}
      >
        <TrafficLights />
        {/* The name of the thing being shown, the way an editor names the open
            file. The code rather than a sentence, because the sentence is on
            the page that opened this window and a second copy of it here is
            the redundancy this was rewritten to remove. */}
        <span
          data-tauri-drag-region
          className="pointer-events-none flex-1 truncate font-mono text-code text-muted-foreground"
        >
          {failure.code}
        </span>
        {reason !== null ? <CopyButton text={reason} /> : null}
      </header>

      {!read ? null : reason === null ? (
        <p className="p-4 text-ui text-muted-foreground">
          The supervisor is not reporting a failure. The harness may have started since this
          window was opened.
        </p>
      ) : (
        <LogView text={reason} />
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    // Only on success. A control that says "Copied" when the write was refused
    // is worse than one that does nothing.
    if (!(await copyText(text))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), COPIED_MS)
  }

  return (
    <IconButton label={copied ? 'Copied' : 'Copy'} size="sm" onClick={() => void copy()}>
      {copied ? <Icons.check size="sm" /> : <Icons.copy size="sm" />}
    </IconButton>
  )
}

/**
 * The file.
 *
 * Fills the window, scrolls in both directions, and does not wrap: wrapping
 * breaks the one-number-per-line correspondence the gutter depends on, and log
 * lines are meant to be scanned rather than read as paragraphs.
 */
function LogView({ text }: { text: string }) {
  // No trailing blank line from a final newline: a numbered empty row at the
  // bottom reads as output that is still arriving.
  const lines = text.replace(/\n+$/, '').split('\n')

  return (
    <div className="studio-scroll-inset min-h-0 flex-1 overflow-auto bg-code-surface py-2">
      <table className="w-full border-separate border-spacing-0 font-mono text-code">
        <tbody>
          {lines.map((line, index) => (
            // The index is the identity here, and legitimately so: this is a
            // fixed snapshot of text that never reorders or splices.
            <tr key={index}>
              {/* Sticky so the numbers stay put while a long line is scrolled
                  sideways, which is the whole reason to keep them in a column
                  rather than as a prefix. */}
              <td className="sticky left-0 z-10 w-px select-none bg-code-surface px-3 text-right align-top text-muted-foreground/45">
                {index + 1}
              </td>
              <td className="pr-6 pl-1 align-top whitespace-pre text-foreground/90">
                {/* A space for an empty line, so its row keeps its height and
                    the numbers stay level with the text beside them. */}
                {line === '' ? ' ' : line}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
