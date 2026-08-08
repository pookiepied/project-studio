import { motion } from 'framer-motion'

/**
 * The mark that trails streaming text.
 *
 * A soft pulsing block rather than a hard blink: at token speed a sharp blink
 * fights the text appearing beside it, while a slow opacity breath reads as
 * "still going" without pulling the eye off the words.
 *
 * It is inline so it sits on the text baseline and reflows with the last line
 * instead of being positioned against the container.
 */
export function StreamingCursor() {
  return (
    <motion.span
      aria-hidden
      initial={{ opacity: 0.25 }}
      animate={{ opacity: [0.25, 1, 0.25] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
      className="ml-0.5 inline-block h-[1em] w-[3px] translate-y-[0.15em] rounded-full bg-foreground/80 align-baseline"
    />
  )
}
