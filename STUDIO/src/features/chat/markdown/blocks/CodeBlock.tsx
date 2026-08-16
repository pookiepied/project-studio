import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { copyText } from '@/lib/clipboard'
import { BlockFrame } from '@/features/chat/markdown/blocks/BlockFrame'
import { SyntaxHighlighter, displayName, resolveLanguage } from '@/features/chat/markdown/languages'

/** Fold past roughly this many lines. */
const COLLAPSED_HEIGHT = 360

/** How long the copy button holds its confirmation. */
const COPIED_MS = 2000

/**
 * Fenced code.
 *
 * The frame, the header and the folding are `BlockFrame`'s. What is left here
 * is the three things that are actually about code: highlighting it, wrapping
 * it, and copying it.
 *
 * ---- The containment problem ---------------------------------------------
 *
 * A code block is the one piece of model output that can be arbitrarily wide,
 * and a wide `<pre>` stretches its parent rather than scrolling inside it. Once
 * that happens the transcript column widens and every message reflows -- which
 * is the failure that makes code blocks look broken in most chat interfaces.
 *
 * Three things stop it and all three are required: `min-w-0` here and on every
 * flex ancestor up to the scroll container, `overflow-hidden` on the frame, and
 * exactly one scroller per axis. That last one is easy to get wrong invisibly:
 * the highlighter renders its own `<pre>` with `white-space: pre`, so the
 * `<pre>` *is* the horizontal scroller, and adding `overflow-auto` to a wrapper
 * nests two scrollers on one axis -- after which a wheel gesture is claimed by
 * whichever happens to be under the pointer.
 *
 * ---- Why there is no vertical scroller any more --------------------------
 *
 * There used to be a `max-h-96` scroller inside the block. That is a second
 * scroll region inside a scrolling transcript, and reaching the bottom of a
 * code block while scrolling the page stops the page dead. Folding replaces
 * it: collapsed, the block is short; expanded, it is simply as tall as it is
 * and the page scrolls the way it does everywhere else.
 */
export function CodeBlock({ code, fence }: { code: string; fence: string }) {
  const [copied, setCopied] = useState(false)
  const [wrap, setWrap] = useState(false)

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
      // The highlighter's `<pre>` is the scroller, so it gets the whole panel
      // and pads itself. See `flush`.
      flush
      collapsedHeight={COLLAPSED_HEIGHT}
      expandLabel={(folded) => (folded ? `Show all ${lines}` : 'Collapse')}
      actions={
        <>
          <IconButton
            label={wrap ? 'Stop wrapping lines' : 'Wrap long lines'}
            size="sm"
            active={wrap}
            onClick={() => setWrap((value) => !value)}
          >
            <Icons.wordWrap />
          </IconButton>

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
        wrapLongLines={wrap}
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
