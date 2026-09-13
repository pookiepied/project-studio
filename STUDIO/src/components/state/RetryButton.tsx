import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/primitives'

/**
 * "Try again", busy for as long as the retry takes.
 *
 * The remedy under a failed read is always the same button around a
 * different promise -- ask the store to read again, ask the supervisor to
 * start the harness -- and every surface that drew it kept its own busy
 * flag and its own `.finally` to clear it. The flag belongs to the button:
 * a surface names what could not happen (the `StateNote` title, in its own
 * voice) and hands over the retry; the button owns the wait.
 *
 * The busy state is not cleared after unmount. A retry that succeeds
 * usually replaces the note that held this button, and setting state on
 * the button that just left is the warning React prints for exactly that.
 */
export function RetryButton({
  onRetry,
  children = 'Try again',
}: {
  onRetry: () => Promise<unknown>
  children?: string
}) {
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  return (
    <Button
      variant="secondary"
      size="sm"
      busy={busy}
      onClick={() => {
        setBusy(true)
        void onRetry().finally(() => {
          if (mounted.current) setBusy(false)
        })
      }}
    >
      {children}
    </Button>
  )
}
