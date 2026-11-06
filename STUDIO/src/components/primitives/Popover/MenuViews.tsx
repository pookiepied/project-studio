import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'framer-motion'
import { DURATION, EASE_IN, EASE_OUT } from '@/design/tokens'

const TRAVEL = 10
const VARIANTS = {
  enter: (depth: number) => ({ opacity: 0, x: depth > 0 ? TRAVEL : depth < 0 ? -TRAVEL : 0 }),
  settled: {
    opacity: 1,
    x: 0,
    transition: { duration: DURATION.base, ease: EASE_OUT },
  },
  leave: (depth: number) => ({
    opacity: 0,
    x: depth > 0 ? -TRAVEL : depth < 0 ? TRAVEL : 0,
    transition: { duration: DURATION.fast, ease: EASE_IN },
  }),
}

export function MenuViews({
  view,
  depth,
  resize = true,
  children,
}: {
  view: string
  depth: number
  resize?: boolean
  children: ReactNode
}) {
  const previous = useRef({ view, depth })
  const direction = useRef(0)
  const content = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  const travel = previous.current.view === view ? direction.current : depth - previous.current.depth

  useLayoutEffect(() => {
    previous.current = { view, depth }
    direction.current = travel
  }, [view, depth, travel])

  useLayoutEffect(() => {
    const element = content.current
    if (!resize || element === null || typeof ResizeObserver === 'undefined') return
    // Measure the natural page, outside the height transition. Scaling the
    // menu itself would stretch the search field and every glyph inside it.
    const measure = () => setHeight(element.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [resize])

  return (
    <div
      className="relative overflow-hidden transition-[height] duration-base"
      style={{ height: resize ? height : undefined, transitionTimingFunction: `cubic-bezier(${EASE_OUT.join(',')})` }}
    >
      <div ref={content} className="relative">
        <AnimatePresence mode="popLayout" initial={false} custom={travel}>
          <motion.div key={view} custom={travel} variants={VARIANTS} initial="enter" animate="settled" exit="leave">
            <PresentMenuContent>{children}</PresentMenuContent>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

export function PresentMenuContent({ children }: { children: ReactNode }) {
  const present = useIsPresent()
  return <div inert={!present} aria-hidden={present ? undefined : true}>{children}</div>
}
