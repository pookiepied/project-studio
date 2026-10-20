import { useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { isGap } from './captions'

/** How many lines of the reply the stage shows at once. */
export const CAPTION_LINES = 2
/** The strip a leaving line fades through, in lines. */
const LEAVING_STRIP = 0.8

/**
 * The spoken reply as a two-line window.
 *
 * The voice cannot be followed word by word, so the caption does not try to
 * hold the whole reply: it shows the newest two lines, and when a third line
 * starts the text slides up and the oldest line leaves through the top edge.
 * A long answer stays a caption rather than becoming a page.
 *
 * The window is measured rather than counted. The words wrap where the
 * browser wraps them; the caption only reads how tall the text became and
 * moves it so its last two lines sit in view.
 *
 * Both lines in view are fully legible. The fade belongs to a strip above
 * them, where a line goes as it leaves: the strip is drawn into the space
 * above the caption (a negative margin), so it costs the layout nothing and
 * a line is never dimmed while it is still being read.
 */
export function Caption({ tokens }: { tokens: readonly string[] }) {
  const text = useRef<HTMLParagraphElement>(null)
  const [lift, setLift] = useState(0)
  const [lineHeight, setLineHeight] = useState(0)

  useLayoutEffect(() => {
    const node = text.current
    if (node === null) return
    const measure = () => {
      const line = parseFloat(getComputedStyle(node).lineHeight) || 0
      // What sits above the visible window is the leaving strip.
      setLineHeight(line)
      setLift(Math.max(0, node.scrollHeight - line * CAPTION_LINES))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [tokens])

  const strip = Math.round(lineHeight * LEAVING_STRIP)
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        height: lineHeight > 0 ? lineHeight * CAPTION_LINES + strip : undefined,
        marginTop: -strip,
        paddingTop: strip,
        // Only the strip fades; the two lines below it are opaque.
        maskImage: lift > 0 ? `linear-gradient(to bottom, transparent 0, black ${strip}px)` : undefined,
      }}
    >
      <motion.p
        ref={text}
        aria-live="polite"
        animate={{ y: -lift }}
        transition={{ duration: DURATION.base, ease: EASE_OUT }}
        className="studio-display text-pretty text-center text-foreground"
      >
        {/* Words fade in as blocks; the gaps stay plain text, since an
            inline-block gap collapses to nothing and runs the words together. */}
        {tokens.map((token, index) => (isGap(token) ? ' ' : (
          <motion.span
            key={index}
            className="inline-block"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
          >
            {token}
          </motion.span>
        )))}
      </motion.p>
    </div>
  )
}
