import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLLAPSE } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { StudioMark } from '@/components/brand'
import type { Thinking } from '@/domain/session/types'
import { cn } from '@/lib/cn'

/**
 * The reasoning trace.
 *
 * Collapsed by default, always. The trace is working-out, not the answer, and
 * opening it by default puts the least useful text in a reply at the top of it
 * -- the reader has to scroll past somebody else's notes to reach the point.
 * It stays collapsed while streaming too, so the block does not expand and
 * shove the reply down the screen mid-sentence.
 *
 * The header still earns its place while collapsed by carrying the duration:
 * "Thought for 4s" is the one fact about the trace that is worth a glance
 * without opening it.
 *
 * The mark is the brand mark, not a glyph: the same StudioMark that assembles
 * on the splash ripples here while the model works. "Studio is thinking" is
 * said by Studio itself, which no generic spinner can say.
 */
export function ThinkingBlock({ thinking, live }: { thinking: Thinking; live: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mb-2.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          'group/thinking inline-flex items-center gap-1.5 rounded-md py-0.5 pr-1.5 pl-1',
          'text-caption text-muted-foreground transition-colors duration-fast hover:text-foreground',
        )}
      >
        <StudioMark busy={live} size={13} className="text-current" />

        <span>{live ? 'Thinking' : `Thought for ${formatSeconds(thinking.seconds)}`}</span>

        <Icons.disclosure state={open ? 'on' : 'rest'} />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div {...COLLAPSE} className="overflow-hidden">
            <div
              className={cn(
                // Indented behind a rule rather than boxed: a bordered card
                // would give the working-out the same visual weight as the
                // answer sitting under it.
                'studio-selectable mt-1.5 ml-1.5 border-l-2 pl-3',
                'text-caption whitespace-pre-wrap text-muted-foreground',
              )}
            >
              {thinking.text}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function formatSeconds(seconds: number): string {
  if (seconds < 1) return 'a moment'
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.round(seconds / 60)}m`
}
