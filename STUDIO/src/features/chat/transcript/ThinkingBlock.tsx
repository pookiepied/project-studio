import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Expand } from '@/components/icons'
import { StudioMark } from '@/components/brand/StudioMark'
import { cn } from '@/lib/utils'

/**
 * The model's reasoning, above its answer.
 *
 * It is collapsed by default and expands in place — thinking is context, not
 * the result, so it should be available without competing with the answer for
 * the reader's attention.
 *
 * While thinking is still arriving the block auto-expands and the mark ripples,
 * because at that moment it is the only thing there is to show. Once the answer
 * begins, it collapses back on its own.
 */
export function ThinkingBlock({ text, active }: { text: string; active: boolean }) {
  const [manuallyOpen, setManuallyOpen] = useState(false)
  const open = active || manuallyOpen

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setManuallyOpen((value) => !value)}
        aria-expanded={open}
        className="group/think inline-flex items-center gap-1.5 rounded-md py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <StudioMark busy={active} size={13} />
        <span>{active ? 'Thinking…' : 'Thought process'}</span>
        <Expand
          size="xs"
          className={cn('transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="thinking-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <p className="mt-1.5 border-l-2 border-border pl-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {text}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
