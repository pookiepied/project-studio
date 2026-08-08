import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import SyntaxHighlighter from 'react-syntax-highlighter'
import { atomOneDark, atomOneLight } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import { Check, Collapse, Copy, Expand, WordWrap } from '@/components/icons'
import { useTheme } from '@/app/theme/ThemeProvider'
import { displayName } from '@/features/chat/transcript/markdown/languages'
import { cn } from '@/lib/utils'

/** Past this many lines a block offers to collapse itself. */
const COLLAPSE_THRESHOLD = 20

/** How long the copy button holds its confirmation. */
const COPIED_MS = 2000

const EASE_OUT = [0.16, 1, 0.3, 1] as const

/**
 * A fenced code block: a labelled header over highlighted source.
 *
 * The header carries the controls that make long model output readable —
 * word wrap, collapse, copy — because a block that can only be scrolled
 * horizontally is unreadable the moment the model emits a wide line.
 *
 * Collapse appears only past `COLLAPSE_THRESHOLD` lines. Offering it on a
 * three-line snippet is noise.
 */
export function CodeBlock({ code, language }: { code: string; language: string }) {
  const { resolvedTheme } = useTheme()
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [wrap, setWrap] = useState(false)

  const lineCount = code.split('\n').length
  const collapsible = lineCount > COLLAPSE_THRESHOLD

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), COPIED_MS)
    } catch {
      /* Clipboard denied — the source is still selectable by hand. */
    }
  }

  return (
    <div className="my-4 w-full min-w-0 overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{displayName(language)}</span>

        <div className="flex items-center gap-0.5">
          <HeaderButton
            label={wrap ? 'Disable word wrap' : 'Enable word wrap'}
            active={wrap}
            onClick={() => setWrap((value) => !value)}
          >
            <WordWrap size="sm" />
          </HeaderButton>

          {collapsible && (
            <HeaderButton
              label={collapsed ? `Expand ${lineCount} lines` : 'Collapse'}
              onClick={() => setCollapsed((value) => !value)}
            >
              {collapsed ? <Expand size="sm" /> : <Collapse size="sm" />}
            </HeaderButton>
          )}

          {/* Confirmation swaps the glyph in place. An earlier version added a
              "Copied" label, which widened the button and shoved the controls
              beside it sideways on every click — the button you just aimed at
              moved out from under the pointer. */}
          <HeaderButton label={copied ? 'Copied' : 'Copy code'} onClick={copy}>
            <AnimatePresence mode="wait" initial={false}>
              {copied ? (
                <motion.span
                  key="copied"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center"
                >
                  <Check size="sm" />
                </motion.span>
              ) : (
                <motion.span
                  key="copy"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center"
                >
                  <Copy size="sm" />
                </motion.span>
              )}
            </AnimatePresence>
          </HeaderButton>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            {/* Vertical scrolling only. The highlighter's own <pre> already
                owns horizontal overflow, and two nested scrollers on the same
                axis make the block behave unpredictably under the pointer. */}
            <div className="max-h-96 w-full min-w-0 overflow-x-hidden overflow-y-auto">
              <SyntaxHighlighter
                language={language}
                style={resolvedTheme === 'dark' ? atomOneDark : atomOneLight}
                showLineNumbers
                wrapLongLines={wrap}
                customStyle={{
                  margin: 0,
                  padding: '0.875rem 1rem',
                  fontSize: '0.8125rem',
                  lineHeight: 1.6,
                  background: 'transparent',
                }}
                lineNumberStyle={{
                  minWidth: '2.5em',
                  paddingRight: '1em',
                  opacity: 0.35,
                  userSelect: 'none',
                  fontSize: '0.75rem',
                }}
                codeTagProps={{ style: { fontFamily: 'inherit', fontWeight: 400 } }}
              >
                {code}
              </SyntaxHighlighter>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex w-full items-center justify-center gap-2 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <Expand size="sm" />
          <span>Show {lineCount} lines</span>
        </button>
      )}
    </div>
  )
}

function HeaderButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={cn(
        // Fixed square: every header control occupies the same box whatever it
        // renders, so nothing in the row can shift when one of them changes.
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </motion.button>
  )
}
