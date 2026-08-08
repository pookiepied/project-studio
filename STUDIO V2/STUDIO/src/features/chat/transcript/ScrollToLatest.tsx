import type { RefObject } from 'react'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Expand } from '@/components/icons'

/** How far from the bottom still counts as "at the latest message" (px). */
const AT_BOTTOM_SLOP = 120

/**
 * Glides an element to its bottom.
 *
 * Native smooth scrolling rather than a hand-driven animation: it is one line,
 * it already honours `prefers-reduced-motion`, and it keeps running when the
 * tab is backgrounded — a `requestAnimationFrame` loop stops dead there,
 * leaving the transcript stranded halfway.
 */
function scrollToBottom(element: HTMLElement): void {
  element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
}

/**
 * Jumps the transcript back to the newest message.
 *
 * It exists because the transcript deliberately does not follow the tail: with
 * no auto-scroll, a reader who has scrolled up needs a way back that does not
 * involve dragging. It appears only when there is somewhere to go, so it never
 * covers content the reader is already looking at.
 */
export function ScrollToLatest({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const update = () => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight
      setVisible(distance > AT_BOTTOM_SLOP)
    }

    update()
    element.addEventListener('scroll', update, { passive: true })

    // Streaming grows the content without a scroll event, so the button has to
    // re-evaluate as the transcript changes height too.
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)

    return () => {
      element.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [scrollRef])

  const jump = () => {
    const element = scrollRef.current
    if (!element) return
    scrollToBottom(element)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          onClick={jump}
          aria-label="Scroll to latest message"
          initial={{ opacity: 0, y: 6, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.9 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="absolute bottom-3 left-1/2 z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background/80 text-muted-foreground shadow-md backdrop-blur-md transition-colors hover:text-foreground"
        >
          <Expand size="sm" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
