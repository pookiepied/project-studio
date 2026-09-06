import { memo, useState } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { CollapsibleText } from '@/features/chat/transcript/CollapsibleText'
import { MessageActions } from '@/features/chat/transcript/MessageActions'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

/**
 * What you asked for, in the live conversation: the same bubble the demo
 * surface established, carrying exactly what the harness echoed back.
 *
 * The row under it carries copy and nothing else. Editing is not on this
 * protocol at all — a sent message is in the journal, and pretending a bubble
 * can be rewritten would be a control that lies — and copy is the one thing
 * a message of yours owes a reader.
 */
export const LiveUserMessage = memo(function LiveUserMessage({
  item,
}: {
  item: Extract<TranscriptItem, { kind: 'user' }>
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
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

      <MessageActions visible={hovered} align="end" copyPayload={item.text} actions={[]} />
    </motion.div>
  )
})
