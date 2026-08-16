import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { atomOneDark, atomOneLight } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { useAppearance } from '@/design/theme'
import { copyText } from '@/lib/clipboard'
import { SyntaxHighlighter, displayName, resolveLanguage } from '@/features/chat/markdown/languages'

/** Past this many lines a block offers to collapse itself. */
const COLLAPSE_THRESHOLD = 20

/** How long the copy button holds its confirmation. */
const COPIED_MS = 2000

/**
 * A fenced code block: a labelled header over highlighted source.
 *
 * ---- The containment problem, which is the whole point of this file ------
 *
 * A code block is the one piece of model output that can be arbitrarily wide,
 * and the default behaviour of a wide `<pre>` is to stretch its parent rather
 * than scroll inside it. Once that happens the whole transcript column widens
 * and every message in the conversation reflows -- which is the failure that
 * makes code blocks look broken in most chat interfaces.
 *
 * Three things stop it, and all three are required:
 *
 *   1. `min-w-0` here, and on every flex ancestor up to the scroll container.
 *      A flex item defaults to `min-width: auto`, meaning "never shrink below
 *      my content", so without this the block simply refuses to be narrower
 *      than its longest line.
 *   2. `overflow-hidden` on the frame, so the rounded corners actually clip.
 *   3. One scroller per axis, and only one.
 *
 * That third point is worth spelling out because it is easy to get wrong in a
 * way that looks fine. The highlighter renders its own `<pre>` with
 * `white-space: pre` and horizontal overflow, so the `<pre>` is already the
 * horizontal scroller. Giving the wrapper `overflow-auto` therefore puts two
 * scrollers on the same axis, nested, and the block starts behaving
 * unpredictably under the pointer -- a wheel gesture is claimed by whichever
 * one happens to be under it. The wrapper takes the vertical axis only and
 * leaves horizontal to the `<pre>`.
 *
 * Wrapping is offered because horizontal scrolling alone is unreadable the
 * moment a model emits a 300-character line, and it is a toggle rather than a
 * default because wrapping a diff or a table of values destroys its alignment.
 */
export function CodeBlock({ code, fence }: { code: string; fence: string }) {
  const { resolvedTheme } = useAppearance()
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [wrap, setWrap] = useState(false)

  const lineCount = code.split('\n').length
  const collapsible = lineCount > COLLAPSE_THRESHOLD

  const copy = async () => {
    if (!(await copyText(code))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), COPIED_MS)
  }

  return (
    <div className="my-4 w-full min-w-0 overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-2.5 py-1">
        <span className="text-micro font-medium text-muted-foreground">{displayName(fence)}</span>

        <div className="flex items-center gap-0.5">
          <IconButton
            label={wrap ? 'Stop wrapping lines' : 'Wrap long lines'}
            size="sm"
            active={wrap}
            onClick={() => setWrap((value) => !value)}
          >
            <Icons.wordWrap />
          </IconButton>

          {collapsible ? (
            <IconButton
              label={collapsed ? `Show ${lineCount} lines` : 'Collapse'}
              size="sm"
              onClick={() => setCollapsed((value) => !value)}
            >
              {collapsed ? <Icons.expand /> : <Icons.collapse />}
            </IconButton>
          ) : null}

          {/* The confirmation swaps the glyph in place rather than adding a
              "Copied" label. A label widens the button and shoves the controls
              beside it sideways, so the thing you just aimed at moves out from
              under the pointer. */}
          <IconButton label={copied ? 'Copied' : 'Copy code'} size="sm" onClick={() => void copy()}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={copied ? 'copied' : 'copy'}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: DURATION.fast }}
                className="flex items-center"
              >
                {copied ? <Icons.check /> : <Icons.copy />}
              </motion.span>
            </AnimatePresence>
          </IconButton>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="max-h-96 w-full min-w-0 overflow-x-hidden overflow-y-auto">
              <SyntaxHighlighter
                language={resolveLanguage(fence)}
                style={resolvedTheme === 'dark' ? atomOneDark : atomOneLight}
                wrapLongLines={wrap}
                customStyle={{
                  margin: 0,
                  padding: '0.75rem 0.875rem',
                  fontSize: 'var(--code-size)',
                  lineHeight: 1.65,
                  background: 'transparent',
                }}
                codeTagProps={{ style: { fontFamily: 'var(--font-mono)', fontWeight: 400 } }}
              >
                {code}
              </SyntaxHighlighter>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex w-full items-center justify-center gap-2 py-2 text-caption text-muted-foreground transition-colors hover:bg-tint hover:text-foreground"
        >
          <Icons.expand />
          Show {lineCount} lines
        </button>
      ) : null}
    </div>
  )
}
