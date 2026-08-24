import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { Button } from '@/components/primitives'
import { CollapsibleText } from '@/features/chat/transcript/CollapsibleText'
import { MessageActions } from '@/features/chat/transcript/MessageActions'
import type { Message } from '@/domain/session/types'

/**
 * What you said: a bubble on the trailing edge.
 *
 * The asymmetry with the reply is the design. A prompt is a short bounded thing
 * you placed, so it gets an object. A reply is a document, so it gets no
 * container at all. Giving both a bubble frames the longest text in the app
 * inside a box and makes the column read as a chat log rather than something
 * worth reading.
 *
 * Editing happens in place. A dialog for changing one sentence is a second
 * surface for a one-line change, and it hides the conversation the sentence
 * belongs to at exactly the moment you are trying to rewrite it in context.
 */
export function UserMessage({
  message,
  onEdit,
}: {
  message: Message
  onEdit: (text: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.text)
  const field = useRef<HTMLTextAreaElement>(null)

  const commit = () => {
    if (draft.trim() && draft.trim() !== message.text) onEdit(draft)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[85%] rounded-xl border bg-surface-raised p-2">
          <textarea
            ref={field}
            autoFocus
            value={draft}
            rows={Math.min(10, draft.split('\n').length + 1)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraft(message.text)
                setEditing(false)
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                commit()
              }
            }}
            className="studio-selectable block w-full resize-none bg-transparent px-1 text-body text-foreground outline-none"
          />
          <div className="mt-1.5 flex items-center justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(message.text)
                setEditing(false)
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={commit}>
              Send
            </Button>
          </div>
        </div>
      </div>
    )
  }

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
        <CollapsibleText text={message.text} />
      </div>

      <MessageActions
        visible={hovered}
        align="end"
        copyPayload={message.text}
        actions={[
          {
            id: 'edit',
            label: 'Edit',
            icon: Icons.edit,
            run: () => {
              setDraft(message.text)
              setEditing(true)
            },
          },
          // Copy and edit, and nothing else.
          //
          // Branching lived here too and did not belong. A branch is a fork of
          // the *conversation* from a point in it, and the point is always the
          // reply you want to redo — offering it on your own message asks the
          // reader to work out what "from here" means when "here" is something
          // they wrote. It is still on every assistant message, where the
          // question it answers is the one people actually have.
        ]}
      />
    </motion.div>
  )
}
