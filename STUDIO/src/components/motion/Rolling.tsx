import { useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_IN, EASE_OUT } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * A number that rolls to its new value, one digit at a time.
 *
 * Each place keeps its own column, so only the digits that changed move:
 * 9 to 10 rolls the ones and brings in a tens, it does not replace the whole
 * figure. A rise rolls up from below and a fall rolls down from above, so the
 * motion says which way the count went. The figure is read out once, whole,
 * not digit by digit.
 */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const previous = useRef(value)
  const direction = value >= previous.current ? 1 : -1
  previous.current = value
  const digits = String(Math.max(0, Math.round(value))).split('')
  return (
    <span className={cn('inline-flex tabular-nums', className)}>
      <span className="sr-only">{digits.join('')}</span>
      <span aria-hidden className="relative inline-flex">
        <AnimatePresence initial={false} custom={direction}>
          {digits.map((digit, index) => (
            // Keyed by place from the right, so the ones stay the ones as the
            // number grows a digit.
            <Digit key={digits.length - index} digit={digit} direction={direction} />
          ))}
        </AnimatePresence>
      </span>
    </span>
  )
}

function Digit({ digit, direction }: { digit: string; direction: number }) {
  return (
    <motion.span
      layout="position"
      className="relative inline-flex overflow-hidden"
      initial={{ opacity: 0, width: 0 }}
      animate={{ opacity: 1, width: 'auto' }}
      exit={{ opacity: 0, width: 0 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
    >
      <AnimatePresence initial={false} mode="popLayout" custom={direction}>
        <motion.span
          key={digit}
          custom={direction}
          variants={ROLL}
          initial="enter"
          animate="center"
          exit="leave"
          className="inline-block"
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  )
}

const ROLL = {
  enter: (direction: number) => ({ y: `${String(direction * 90)}%`, opacity: 0 }),
  center: { y: '0%', opacity: 1, transition: { duration: DURATION.slow, ease: EASE_OUT } },
  leave: (direction: number) => ({ y: `${String(direction * -90)}%`, opacity: 0, transition: { duration: DURATION.base, ease: EASE_IN } }),
}

/**
 * Words that change in place: the new ones rise in as the old ones rise out.
 *
 * `id` names what is being said, so a change of meaning swaps and a re-render
 * of the same words does not. The old words leave without holding their
 * space, so the line around them can move to the new width at once.
 */
export function SwapText({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn('relative inline-flex min-w-0', className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={id}
          className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap"
          initial={{ y: '70%', opacity: 0, filter: 'blur(2px)' }}
          animate={{ y: '0%', opacity: 1, filter: 'blur(0px)', transition: { duration: DURATION.slow, ease: EASE_OUT } }}
          exit={{ y: '-70%', opacity: 0, filter: 'blur(2px)', transition: { duration: DURATION.base, ease: EASE_IN } }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
