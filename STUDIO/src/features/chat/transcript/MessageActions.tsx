import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'

export interface MessageAction {
  readonly id: string
  readonly label: string
  readonly icon: typeof Icons.copy
  readonly run: () => void
}

/**
 * The row of actions under a message.
 *
 * Revealed on hover rather than always drawn: a transcript with four buttons
 * permanently under every turn is a transcript you read past rather than read.
 *
 * Two details that are not incidental. It keeps its height while hidden, so
 * revealing it does not shove the next message down -- opacity only, never
 * mount and unmount. And it stays visible while any of its own buttons has
 * focus, so tabbing through the row does not make it disappear under the
 * keyboard user.
 */
export function MessageActions({
  actions,
  copyPayload,
  align = 'start',
  visible,
  trailing,
}: {
  actions: readonly MessageAction[]
  /** Text for the built-in copy button, which every message has. */
  copyPayload: string
  align?: 'start' | 'end'
  visible: boolean
  /**
   * Sits at the end of the same row -- the model's name, today.
   *
   * A slot rather than a sibling, and that is the fix rather than a
   * convenience. As a sibling in a wrapper it did not share this row's top
   * margin, so the two were offset by the full 12px and the name floated above
   * the buttons it belonged to. Inside the row there is one baseline, one
   * margin and one fade, and they cannot come apart again.
   */
  trailing?: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)

  const copy = async () => {
    if (!(await copyText(copyPayload))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const shown = visible || focusWithin

  return (
    <motion.div
      animate={{ opacity: shown ? 1 : 0 }}
      transition={{ duration: DURATION.fast, ease: EASE_OUT }}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setFocusWithin(false)
      }}
      className={cn(
        // `mt-3`, not `mt-1`. At 4px the row sat on the last line of the reply
        // and read as part of it -- the controls looked like a footer attached
        // to the final paragraph rather than something belonging to the whole
        // message. The gap has to be larger than the prose's own line spacing
        // for the row to separate from it.
        'mt-3 flex items-center gap-0.5',
        align === 'end' && 'justify-end',
        // Pulled out by the button's optical inset so the first *glyph* lines
        // up with the text column, not the button's box. A 24px circle holding
        // a ~14px mark insets it about 5px, which is why the row looked
        // indented under a reply that starts flush left. Alignment is between
        // what the eye sees, and the eye does not see the padding.
        align === 'end' ? '-mr-[5px]' : '-ml-[5px]',
        // Hidden from the pointer as well as the eye: invisible buttons that
        // still take clicks are worse than visible ones.
        !shown && 'pointer-events-none',
      )}
    >
      <IconButton label={copied ? 'Copied' : 'Copy'} size="sm" onClick={() => void copy()}>
        {copied ? <Icons.check /> : <Icons.copy />}
      </IconButton>

      {actions.map((action) => {
        const Glyph = action.icon
        return (
          <IconButton key={action.id} label={action.label} size="sm" onClick={action.run}>
            <Glyph />
          </IconButton>
        )
      })}

      {/* A little clear of the buttons, so the name reads as a caption on the
          row rather than as a fifth control. */}
      {trailing ? <span className="ml-1.5 flex items-center">{trailing}</span> : null}
    </motion.div>
  )
}
