import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { DURATION, EASE_IN, EASE_OUT } from '@/design/tokens'

/** Restore the folded right panel; its own header handles collapse while open. */
export function WorkspaceAccess({ onOpen }: { onOpen?: () => void }) {
  const reducedMotion = useReducedMotion()
  const duration = reducedMotion ? 0 : DURATION.base
  return (
    <AnimatePresence initial={false}>
      {onOpen ? (
        <motion.div
          key="workspace-access"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 'auto', opacity: 1, transition: { duration, ease: EASE_OUT } }}
          exit={{ width: 0, opacity: 0, transition: { duration, ease: EASE_IN } }}
          className="flex shrink-0 overflow-hidden"
        >
          <IconButton label="Workspace" tooltipSide="bottom" onClick={onOpen}>
            <Icons.workspace size="md" />
          </IconButton>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
