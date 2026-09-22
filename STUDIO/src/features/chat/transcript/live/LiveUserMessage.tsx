import { memo, useState } from 'react'
import { motion } from 'framer-motion'
import { Icons } from '@/components/icons'
import { ENTER } from '@/design/tokens'
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
      initial={ENTER.initial}
      animate={ENTER.animate}
      transition={ENTER.transition}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="flex flex-col items-end"
    >
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-selected px-3.5 py-2.5 text-foreground">
        <CollapsibleText text={item.text} />
        {item.attachments.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap justify-end gap-1">
            {/* Keyed by position, which is the only identity these have. An
                attachment carries no id, and two files can honestly share a
                type and a name - a pasted screenshot is `image.png` every
                time - so keying on those collided the moment somebody
                attached two of them: React warned, and one of the pair was
                free to be dropped or duplicated. Position is safe here in
                the way it usually is not, because this list is a sent
                message's own record: it arrives once and never reorders,
                grows or shrinks. */}
            {item.attachments.map((attachment, index) => (
              <span
                key={`${index}-${attachment.mediaType}-${attachment.filename ?? ''}`}
                className="rounded-full bg-surface-raised px-2 py-0.5 text-caption text-muted-foreground"
              >
                {attachment.filename ?? attachment.mediaType}
              </span>
            ))}
          </div>
        ) : null}
        {item.documents.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap justify-end gap-1">
            {/* A document is not an attachment: it was uploaded ahead of the
                words and named to the model by a signal, and these are that
                signal's facts. Keyed by the id the harness gave the upload. */}
            {item.documents.map((document) => (
              <span
                key={document.id}
                title={`${document.fileName} - ${formatPages(document)}, ${formatBytes(document.byteLength)}`}
                className="inline-flex items-center gap-1 rounded-full bg-surface-raised px-2 py-0.5 text-caption text-muted-foreground"
              >
                <Icons.file size="sm" />
                <span className="max-w-48 truncate">{document.fileName}</span>
                <span className="text-muted-foreground/70">{formatPages(document)}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <MessageActions visible={hovered} align="end" copyPayload={item.text} actions={[]} />
    </motion.div>
  )
})

/** "12 pages", "1 slide", "3 sheets": what the document gave the model. */
function formatPages(document: { readonly pageCount: number; readonly unit: string }): string {
  return `${document.pageCount} ${document.unit}${document.pageCount === 1 ? '' : 's'}`
}

function formatBytes(byteLength: number): string {
  if (byteLength < 1024 * 1024) return `${Math.max(1, Math.round(byteLength / 1024))} KB`
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
}
