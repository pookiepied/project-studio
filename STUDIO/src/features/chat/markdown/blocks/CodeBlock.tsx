import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { FormatGlyph, Mark, formatOfName, markOfName } from '@/components/icons/fileTypes'
import { IconButton } from '@/components/primitives'
import { copyText } from '@/lib/clipboard'
import { BlockFrame } from '@/features/chat/markdown/blocks/BlockFrame'
import { SyntaxHighlighter, displayName, resolveLanguage } from '@/features/chat/markdown/languages'

/** How long the copy button holds its confirmation. */
const COPIED_MS = 2000

/**
 * A code block's glyph is the language's own mark -- the same marks the tool
 * chips carry -- keyed on the fence's own word, because a fence names a
 * language, not a file; going through the highlighter's resolution would
 * lose every language it does not parse and mark plain `java` as unknown.
 * Brand-less formats (SQL, XML, YAML) take their concept's registry icon;
 * languages with neither (SQL's neighbours diff, TOML aside) fall to the
 * coding mark, which is the honest "code, kind unspecified".
 */
function Glyph({ fence }: { fence: string }) {
  const mark = markOfName(fence)
  if (mark !== null) return <Mark mark={mark} className="shrink-0 text-muted-foreground" />
  const format = formatOfName(fence)
  if (format !== null) {
    return <FormatGlyph format={format} size="sm" className="shrink-0 text-muted-foreground" />
  }
  return <Icons.coding size="sm" className="shrink-0 text-muted-foreground" />
}

/**
 * Fenced code, in the artifact container, shown in full.
 *
 * ---- The containment problem ---------------------------------------------
 *
 * A code block is the one piece of model output that can be arbitrarily wide,
 * and a wide `<pre>` stretches its parent rather than scrolling inside it. Once
 * that happens the transcript column widens and every message reflows — which
 * is the failure that makes code blocks look broken in most chat interfaces.
 * So the body scrolls both ways inside the frame's own cap, and `min-w-0` on
 * every flex ancestor up to the scroll container is what lets the frame hold
 * the column at all.
 *
 * Lines do not wrap. Wrapped code misreads structure -- a wrapped line looks
 * like two -- and this block is a working surface now, not a preview; the
 * horizontal scroller is the honest answer to a long line.
 */
export function CodeBlock({ code, fence }: { code: string; fence: string }) {
  const [copied, setCopied] = useState(false)

  // ```ts:src/utils/get-diff.ts — the language, then optionally where this came
  // from. A path makes a far better caption than a language name: "TypeScript"
  // is already obvious from the syntax colouring, while *which file* is the one
  // thing the block cannot tell you itself.
  const [language, ...rest] = fence.split(':')
  const path = rest.join(':') || undefined

  const lines = code.split('\n').length

  const copy = async () => {
    if (!(await copyText(code))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), COPIED_MS)
  }

  return (
    <BlockFrame
      glyph={<Glyph fence={language} />}
      label={path ?? displayName(language)}
      meta={lines === 1 ? '1 line' : `${lines} lines`}
      actions={
        <>
          {/* The confirmation swaps the glyph in place rather than adding a
              "Copied" label. A label widens the button and shoves its
              neighbours sideways, so the thing you just aimed at moves out
              from under the pointer. The same button the artifacts carry. */}
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
                {copied ? <Icons.check size="sm" /> : <Icons.copy size="sm" />}
              </motion.span>
            </AnimatePresence>
          </IconButton>
        </>
      }
    >
      {/* `useInlineStyles={false}` is the whole theme decision. The highlighter
          emits `hljs-*` class names and the palette lives in `index.css` next
          to the tokens, so it follows the theme with no prop, no re-render and
          no imported colour object. The container's own radius and overflow
          clip the corners, so the highlighter paints none of its own.
          Line numbers ride the highlighter's own gutter -- it is the only
          renderer that can number the lines the tokens actually land on -- and
          the numbers are unselectable, so a hand-dragged selection copies
          code, not a column of digits. The copy button copies the raw text
          either way. */}
      <SyntaxHighlighter
        language={resolveLanguage(language)}
        useInlineStyles={false}
        showLineNumbers
        lineNumberStyle={{
          display: 'inline-block',
          minWidth: '1.75rem',
          marginRight: '0.75rem',
          textAlign: 'right',
          color: 'var(--muted-foreground)',
          opacity: 0.65,
          userSelect: 'none',
        }}
        className="studio-code"
        customStyle={{
          margin: 0,
          // No top padding: the head above already separates the code from
          // everything else, and a second gap under the rule read as the code
          // starting late. The bottom keeps its own -- the last line must not
          // sit on the frame's edge or under the horizontal bar. The last
          // value is the code's left inset; the gutter sits closer to the
          // frame's edge than the code sits to the gutter, which is the
          // ordering an editor reads by.
          padding: '0 1.125rem 0.875rem 0.75rem',
          fontSize: 'var(--code-size)',
          lineHeight: 1.7,
          background: 'transparent',
        }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono)', fontWeight: 400 } }}
      >
        {code}
      </SyntaxHighlighter>
    </BlockFrame>
  )
}
