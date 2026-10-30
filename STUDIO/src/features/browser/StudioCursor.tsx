import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { LiveBrowserState } from '@/domain/browser/live'
import { cn } from '@/lib/cn'

/** Press feedback uses live samples; initial snapshots and repeated polls never replay clicks. */
export function StudioCursor({ cursor }: { cursor: NonNullable<LiveBrowserState['cursor']> }) {
  const previous = useRef(cursor.pressSequence)
  const [pulse, setPulse] = useState<number | null>(null)
  useEffect(() => {
    const next = cursor.pressSequence
    if (next !== undefined && previous.current !== undefined && next > previous.current) setPulse(next)
    previous.current = next
  }, [cursor.pressSequence])

  return <>
    <AnimatePresence>
      {cursor.pressed ? <motion.span key="held" data-feedback="press" aria-hidden="true"
        className="absolute -left-2 -top-2 size-4 rounded-full border border-foreground/30 bg-background/15 ring-1 ring-background/40"
        initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 2 }}
        transition={{ duration: 0.16 }} /> : null}
    </AnimatePresence>
    {pulse === null ? null : <motion.span key={pulse} data-feedback="click" data-press-sequence={pulse} aria-hidden="true"
      className="absolute -left-2 -top-2 size-4 rounded-full border border-foreground/40 ring-1 ring-background/60"
      initial={{ opacity: 0.8, scale: 0.8 }} animate={{ opacity: 0, scale: 2.1 }} transition={{ duration: 0.26, ease: 'easeOut' }} />}
    <svg width="22" height="24" viewBox="0 0 22 24" aria-hidden="true" className={cn('overflow-visible', cursor.kind === 'text' && '-translate-x-1/2 -translate-y-1/2')}>
      {cursor.kind === 'text'
        ? <><path d="M6 2H16M11 2V22M6 22H16" className="stroke-background" strokeWidth="3" /><path d="M6 2H16M11 2V22M6 22H16" className="stroke-foreground" strokeWidth="1.5" /></>
        : <motion.path d="M0 0L5 20L9 12L18 8Z" fill="white" stroke="#1e1e1e" strokeWidth="1.1" strokeLinejoin="round"
          animate={{ scale: cursor.pressed ? 0.9 : 1 }} style={{ originX: 0, originY: 0 }} transition={{ duration: 0.09 }} />}
    </svg>
    <span className="ml-2.5 inline-flex h-[18px] items-center rounded-full bg-[#1e1e1e] px-2 text-[10px] text-white">Studio</span>
  </>
}
