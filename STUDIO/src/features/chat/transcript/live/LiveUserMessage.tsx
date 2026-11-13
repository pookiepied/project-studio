import { Tooltip } from '@/components/primitives'
import { memo, useState, type Ref } from 'react'
import { motion } from 'framer-motion'
import { FileTypeMark } from '@/components/icons/fileTypes'
import { ENTER } from '@/design/tokens'
import { CollapsibleText } from '@/features/chat/transcript/CollapsibleText'
import { MessageActions } from '@/features/chat/transcript/MessageActions'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { UserImageAttachment } from './UserImageAttachment'

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
  firstArrival = false,
  bubbleRef,
  conversationId = null,
}: {
  item: Extract<TranscriptItem, { kind: 'user' }>
  firstArrival?: boolean
  bubbleRef?: Ref<HTMLDivElement>
  conversationId?: string | null
}) {
  const [hovered, setHovered] = useState(false)
  const hasText = item.text.trim() !== ''
  const pictures = item.attachments.flatMap((attachment, index) => /^image\//i.test(attachment.mediaType) ? [{ attachment, index }] : [])
  const files = item.attachments.flatMap((attachment, index) => /^image\//i.test(attachment.mediaType) ? [] : [{ attachment, index }])
  const hasBubble = hasText || files.length > 0 || item.documents.length > 0
  return (
    <motion.div
      initial={firstArrival ? false : ENTER.initial}
      animate={ENTER.animate}
      transition={ENTER.transition}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="flex flex-col items-end"
    >
      {pictures.length > 0 ? <div ref={hasBubble ? undefined : bubbleRef} className="mb-2 flex max-w-[90%] flex-wrap justify-end gap-2">
        {pictures.map(({ attachment, index }) => <UserImageAttachment
          key={`${conversationId ?? ''}:${item.id}:${index}:${attachment.id ?? ''}`}
          attachment={attachment} index={index} conversationId={conversationId} />)}
      </div> : null}
      {hasBubble ? <div ref={bubbleRef} className="min-w-0 max-w-[90%] rounded-2xl rounded-br-md bg-user-bubble px-4 py-3 text-foreground">
        {hasText ? <CollapsibleText text={item.text} /> : null}
        {files.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap justify-end gap-1">
            {/* Position stays in the key: old records may have no id, and two
                uploads may share a name. A sent attachment list never reorders. */}
            {files.map(({ attachment, index }) => (
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
              <Tooltip key={document.id} label={`${document.fileName} - ${formatPages(document)}, ${formatBytes(document.byteLength)}`}>
              <span
                className="inline-flex items-center gap-1 rounded-full bg-surface-raised px-2 py-0.5 text-caption text-muted-foreground"
              >
                <FileTypeMark path={document.fileName} size="sm" />
                <span className="max-w-48 truncate">{document.fileName}</span>
                <span className="text-muted-foreground/70">{formatPages(document)}</span>
              </span>
              </Tooltip>
            ))}
          </div>
        ) : null}
      </div> : null}

      {hasText ? <MessageActions visible={hovered} align="end" copyPayload={item.text} actions={[]} /> : null}
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
