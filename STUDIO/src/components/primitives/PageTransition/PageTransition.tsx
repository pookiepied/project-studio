import type { ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'framer-motion'
import { surfaceVariants, type SurfaceMove } from '@/design/tokens'
import { cn } from '@/lib/cn'

const VARIANTS = surfaceVariants()

interface PageProps {
  move?: SurfaceMove
  main?: boolean
  className?: string
  children: ReactNode
}

export function PageTransition({ view, move = 'sibling', ...page }: PageProps & { view: string }) {
  return (
    <AnimatePresence initial={false} custom={move}>
      <Page key={view} move={move} {...page} />
    </AnimatePresence>
  )
}

function Page({ move, main, className, children }: PageProps) {
  const present = useIsPresent()
  const Surface = main ? motion.main : motion.div

  return (
    <Surface
      custom={move}
      variants={VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      inert={!present}
      aria-hidden={present ? undefined : true}
      className={cn('absolute inset-0', className)}
    >
      {children}
    </Surface>
  )
}
