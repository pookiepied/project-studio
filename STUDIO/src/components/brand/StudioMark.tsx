import { motion, useReducedMotion } from 'framer-motion'
import { DURATION, EASE_OUT, LOOP } from '@/design/tokens'

const LEAVES = [
  'M31 29C22 28 10 26 9 18c-.8-5 3.4-8.7 8-7.8.9-4.4 4.8-6.6 8.6-4.8C31 8 31.9 19 31 29Z',
  'M33 29c-.7-10.4.6-21.4 6.3-23.9 4.3-1.9 8.2.8 8.7 5.2 4.9-.6 8.8 3.4 7.3 8.3C53 26.1 42 28.5 33 29Z',
  'M31 31c-.5 9-3.3 18.8-9.5 19.4-4.3.5-7.2-2.3-7.2-6.3-4.2-.3-6.5-3.9-5.2-7.3C11.3 31 22.5 30.5 31 31Z',
  'M33 31c9.2-.5 20.5.3 22 6.6 1 4-1.6 7.1-5.6 7.4-.4 4.3-4 6.7-7.6 5.3C36.2 48.2 33.6 39.5 33 31Z',
] as const

export function StudioMark({
  busy = false,
  entrance = false,
  size = 16,
  className,
}: {
  busy?: boolean
  entrance?: boolean
  size?: number
  className?: string
}) {
  const reducedMotion = useReducedMotion()
  const opens = entrance && !reducedMotion
  const pulses = busy && !entrance && !reducedMotion

  return (
    <svg
      height={size}
      width={size}
      viewBox="0 0 64 64"
      fill="currentColor"
      data-studio-mark
      aria-hidden
      className={className}
    >
      <path d="M32 30c1.6 11.5-1.2 21.7-8.2 27.1" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <motion.g
        style={{ transformOrigin: '32px 30px' }}
        initial={opens ? { opacity: 0, scale: 0.68 } : false}
        animate={{ opacity: 1, scale: opens ? [0.68, 1.05, 1] : 1 }}
        transition={{ duration: DURATION.slow, ease: EASE_OUT }}
      >
        {LEAVES.map((leaf, index) => (
          <motion.path
            key={leaf}
            d={leaf}
            animate={{ opacity: pulses ? [0.62, 1, 0.62] : 1 }}
            transition={pulses ? { ...LOOP.pulse, delay: index * 0.1 } : { duration: DURATION.base }}
          />
        ))}
      </motion.g>
    </svg>
  )
}
