import { memo, useState } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
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
 * Copy, and nothing else. Editing lived here once and was removed on purpose:
 * a sent message is in the journal, and a control that offered to rewrite it
 * would be promising something the protocol does not define. Branching lived
 * here too and did not belong. A branch is a fork of the *conversation* from a
 * point in it, and the point is always the reply you want to redo — offering
 * it on your own message asks the reader to work out what "from here" means
 * when "here" is something they wrote. It lives on every assistant message,
 * where the question it answers is the one people actually have.
 */
export const UserMessage = memo(function UserMessage({ message }: { message: Message }) {
  const [hovered, setHovered] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="studio-message flex flex-col items-end"
    >
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-selected px-3.5 py-2.5 text-foreground">
        <CollapsibleText text={message.text} />
      </div>

      <MessageActions visible={hovered} align="end" copyPayload={message.text} actions={[]} />
    </motion.div>
  )
})
