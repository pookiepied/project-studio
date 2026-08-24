import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { CollapsibleText } from '@/features/chat/transcript/CollapsibleText'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

/**
 * What you asked for, in the live conversation: the same bubble the demo
 * surface established, carrying exactly what the harness echoed back.
 *
 * There is no editing here yet, and that is honesty rather than an omission:
 * on this protocol an edit is a new submission with new semantics, and
 * pretending a bubble is editable when nothing defines what that does would
 * be a control that lies. The copy action survives, because it is free.
 */
export function LiveUserMessage({
  item,
}: {
  item: Extract<TranscriptItem, { kind: 'user' }>
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
      className="flex flex-col items-end"
    >
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-selected px-3.5 py-2.5 text-foreground">
        <CollapsibleText text={item.text} />
        {item.attachments.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap justify-end gap-1">
            {item.attachments.map((attachment) => (
              <span
                key={`${attachment.mediaType}-${attachment.filename ?? ''}`}
                className="rounded-full bg-surface-raised px-2 py-0.5 text-caption text-muted-foreground"
              >
                {attachment.filename ?? attachment.mediaType}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </motion.div>
  )
}
