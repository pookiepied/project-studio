import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Animate the space taken by changing content, including rows in a table. */
export function ShowMoreContent({ children }: { children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()

  useLayoutEffect(() => {
    const element = content.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const measure = () => setHeight(element.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return <div className="overflow-clip motion-safe:transition-[height] motion-safe:duration-base motion-safe:ease-[var(--ease-out-quint)]"
    style={{ height }}>
    <div ref={content} className="flow-root">{children}</div>
  </div>
}
