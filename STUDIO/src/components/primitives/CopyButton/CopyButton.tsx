import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives/IconButton/IconButton'
import { copyText } from '@/lib/clipboard'

/** How long the confirmation holds before the glyph returns. */
const COPIED_MS = 2000

/**
 * The copy control every block and message carries.
 *
 * The confirmation swaps the glyph in place rather than adding a "Copied"
 * label. A label widens the button and shoves its neighbours sideways, so
 * the thing you just aimed at moves out from under the pointer. The tooltip
 * carries the word instead.
 *
 * It confirms only when the write worked: `copyText` reports that, and a
 * control that flashes "Copied" after a refused write is worse than one that
 * does nothing. The hold is cancelled on unmount so a block that leaves the
 * page mid-confirmation does not set state on a component that is gone.
 */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const hold = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(hold.current), [])

  const copy = async () => {
    if (!(await copyText(text))) return
    setCopied(true)
    window.clearTimeout(hold.current)
    hold.current = window.setTimeout(() => setCopied(false), COPIED_MS)
  }

  return (
    <IconButton label={copied ? 'Copied' : label} size="sm" onClick={() => void copy()}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? 'copied' : 'copy'}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ duration: DURATION.fast }}
          className="flex items-center"
        >
          {copied ? <Icons.check size="sm" /> : <Icons.copy size="sm" />}
        </motion.span>
      </AnimatePresence>
    </IconButton>
  )
}
