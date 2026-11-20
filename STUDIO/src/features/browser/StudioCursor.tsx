import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

interface CursorFeedback {
  pressed?: boolean
  pressSequence?: number
}

/** Press feedback uses live samples; initial snapshots and repeated polls never replay clicks. */
export function StudioCursor({ cursor }: { cursor: CursorFeedback }) {
  const reducedMotion = useReducedMotion()
  const previous = useRef(cursor.pressSequence)
  const [pulse, setPulse] = useState<number | null>(null)
  useEffect(() => {
    const next = cursor.pressSequence
    if (next !== undefined && previous.current !== undefined && next > previous.current) setPulse(next)
    previous.current = next
  }, [cursor.pressSequence])

  return <>
    <motion.span aria-hidden data-feedback={cursor.pressed ? 'press' : undefined}
      className="absolute -left-8 -top-8 size-16 rounded-full"
      style={{ background: 'radial-gradient(circle, #399fff70, #288fff38 34%, #2385ff12 62%, transparent 88%)' }}
      initial={false}
      animate={{ opacity: cursor.pressed ? 1 : 0.84, scale: cursor.pressed && !reducedMotion ? 0.84 : 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.13 }} />
    {pulse === null ? null : <motion.span key={pulse} data-feedback="click" data-press-sequence={pulse} aria-hidden="true"
      className="absolute -left-6 -top-6 size-12 rounded-full"
      style={{ background: 'radial-gradient(circle, #399fff70, transparent 70%)' }}
      initial={{ opacity: reducedMotion ? 0 : 0.8, scale: 0.75 }}
      animate={{ opacity: 0, scale: reducedMotion ? 0.75 : 1.45 }} transition={{ duration: 0.26, ease: 'easeOut' }} />}
    <svg width="22" height="24" viewBox="0 0 22 24" aria-hidden className="relative overflow-visible">
      <motion.path d="M0.6 0.3C-0.25 0 -0.85 0.65 -0.56 1.64L3.47 17.2C3.78 18.58 5.2 18.76 5.93 17.54L9.71 11.72C10 11.26 10.4 10.99 10.88 10.79L17.25 8.54C18.59 8.04 18.61 6.7 17.25 6.18Z"
        fill="#192330" stroke="#eef6ff" strokeWidth="1.45" strokeLinejoin="round"
        animate={{ scale: reducedMotion ? 1 : cursor.pressed ? 0.82 : pulse === null ? 1 : [0.84, 1.08, 1] }}
        style={{ transformOrigin: '0px 0px' }}
        transition={cursor.pressed ? { duration: 0.08 } : { duration: reducedMotion ? 0 : 0.2, ease: 'easeOut' }} />
    </svg>
  </>
}
