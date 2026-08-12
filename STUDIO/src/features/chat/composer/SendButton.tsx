import { AnimatePresence, motion } from 'framer-motion'
import { Send, Stop } from '@/components/icons'
import { roundIconButton } from '@/features/chat/composer/composerStyles'
import type { ChatStatus } from '@/features/chat/session/types'
import { cn } from '@/lib/utils'

/**
 * Send, and the same button as Stop once a turn is running.
 *
 * It is one button rather than two because the two actions are never available
 * at once, and a control that swaps meaning in place is easier to hit than one
 * that appears beside another. While the turn is only submitting — accepted but
 * not yet producing output — the ring spins, so a slow start still reads as
 * progress rather than a dead click.
 */
export function SendButton({
  status,
  canSend,
  onSend,
  onStop,
}: {
  status: ChatStatus
  canSend: boolean
  onSend: () => void
  onStop: () => void
}) {
  const busy = status === 'submitting' || status === 'thinking' || status === 'streaming'
  const waiting = status === 'submitting'

  if (busy) {
    return (
      <button
        type="button"
        onClick={onStop}
        aria-label="Stop generating"
        className={cn(roundIconButton, 'relative bg-muted text-foreground hover:bg-muted/70')}
      >
        <AnimatePresence>
          {waiting && (
            <motion.span
              key="pending-ring"
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, rotate: 360 }}
              exit={{ opacity: 0 }}
              transition={{
                rotate: { duration: 0.9, repeat: Infinity, ease: 'linear' },
                opacity: { duration: 0.15 },
              }}
              className="absolute inset-0 rounded-full border-2 border-foreground/25 border-t-foreground"
            />
          )}
        </AnimatePresence>
        <Stop size="sm" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onSend}
      disabled={!canSend}
      aria-label="Send message"
      className={cn(
        roundIconButton,
        'bg-primary text-primary-foreground hover:bg-primary/85',
        'disabled:bg-muted disabled:text-muted-foreground',
      )}
    >
      <Send size="sm" />
    </button>
  )
}
