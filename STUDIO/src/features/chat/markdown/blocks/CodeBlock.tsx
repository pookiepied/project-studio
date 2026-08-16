import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { copyText } from '@/lib/clipboard'
import { BlockFrame } from '@/features/chat/markdown/blocks/BlockFrame'
import { SyntaxHighlighter, displayName, resolveLanguage } from '@/features/chat/markdown/languages'

/** The preview cap, in px. Roughly a screen of code is not what a preview is. */
const PREVIEW_HEIGHT = 360

/** How long the copy button holds its confirmation. */
const COPIED_MS = 2000

/**
 * Fenced code, as a preview.
 *
 * The frame, the caption and the cap are `BlockFrame`'s. What is left here is
 * the two things that are actually about code: highlighting it and copying it.
 *
 * ---- The containment problem ---------------------------------------------
 *
 * A code block is the one piece of model output that can be arbitrarily wide,
 * and a wide `<pre>` stretches its parent rather than scrolling inside it. Once
 * that happens the transcript column widens and every message reflows -- which
 * is the failure that makes code blocks look broken in most chat interfaces.
 *
 * Wrapping is what stops it now. There is no scroller in any direction: the
 * lines wrap at the column (`pre-wrap`), so there is nothing to overflow, and
 * `min-w-0` on every flex ancestor up to the scroll container is what lets the
 * wrapping happen at the column at all. A scroller was the earlier answer, and
 * it traded the reflow for a second scroll region inside a scrolling transcript
 * -- reach the bottom of a block while scrolling the page and the page stops
 * dead. Wrapping has no such failure, and a preview does not owe anyone an
 * unwrapped 300-character line.
 *
 * ---- Why there is no expansion -------------------------------------------
 *
 * "Show all 44 lines" made the block a reader with a mode toggle: the
 * transcript stopped for as long as the block was tall, and the control that
 * promised more code was also the control that broke the page's rhythm. A
 * preview states what the code is and hands over the copy button. The full
 * text is one click away in the clipboard, which is where long code was always
 * going anyway.
 */
export function CodeBlock({ code, fence }: { code: string; fence: string }) {
  const [copied, setCopied] = useState(false)

  // ```ts:src/utils/get-diff.ts -- the language, then optionally where this came
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
      // The caption goes under the code, and the code is what you came for.
      label={path ?? displayName(language)}
      meta={lines === 1 ? 'Line 1' : `Lines 1–${lines}`}
      // The highlighter pads itself. See `flush`.
      flush
      previewHeight={PREVIEW_HEIGHT}
      actions={
        <>
          {/* The confirmation swaps the glyph in place rather than adding a
              "Copied" label. A label widens the button and shoves its
              neighbours sideways, so the thing you just aimed at moves out
              from under the pointer. */}
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
        </>
      }
    >
      {/* `useInlineStyles={false}` is the whole theme decision. The highlighter
          emits `hljs-*` class names and the palette lives in `index.css` next
          to the tokens, so it follows the theme with no prop, no re-render and
          no imported colour object. */}
      <SyntaxHighlighter
        language={resolveLanguage(language)}
        useInlineStyles={false}
        wrapLongLines
        className="studio-code"
        customStyle={{
          margin: 0,
          padding: '0.875rem 1.125rem',
          // Stated, not `inherit`. `inherit` resolves against the immediate
          // parent -- the frame's plain body wrapper, which has no radius --
          // so it silently computed to 0 and the scrollbar squared off the
          // corner it now sits in.
          borderRadius: 'var(--radius-block-inner)',
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
