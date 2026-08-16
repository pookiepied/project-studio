import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COMPOSER, DURATION, EASE_OUT, RADIUS } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { AddMenu } from '@/features/chat/composer/AddMenu'
import { ComposerField, type ComposerFieldHandle } from '@/features/chat/composer/ComposerField'
import { useTypeToFocus } from '@/features/chat/composer/useTypeToFocus'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

/**
 * The composer.
 *
 * ---- What it is not ------------------------------------------------------
 *
 * It carries no model picker, no permission control and no context meter. All
 * three moved to the top strip, because they are session facts -- who you are
 * talking to and what it may do -- rather than properties of the sentence you
 * are writing. Kept here they turned the field into a toolbar, which is the
 * single loudest way a text box stops looking calm.
 *
 * What is left is what genuinely belongs to this message: what to add to it,
 * and whether to send it.
 *
 * ---- The shape ------------------------------------------------------------
 *
 * A capsule while it holds one line, a rounded box once it holds more. Both are
 * correct and neither is correct for the other case: a capsule with four lines
 * of text has enormous dead corners, and a 16px box on a single line reads as a
 * form input. The radius animates between them, so growing feels like one
 * object changing rather than two components swapping.
 *
 * Separation is a shadow, not a border. A hairline around a white field on a
 * white surface reads as an input; a soft shadow reads as an object resting on
 * the page, which is what the reference does.
 */
export function Composer({
  conversationId,
  projectId,
  placeholder,
  onSent,
}: {
  conversationId: string | null
  projectId: string | null
  placeholder: string
  onSent?: (conversationId: string) => void
}) {
  const { status, send, stop } = useWorkspace()
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [multiline, setMultiline] = useState(false)
  const field = useRef<ComposerFieldHandle>(null)

  const focus = useCallback(() => field.current?.focus(), [])
  useTypeToFocus(true, focus)

  const busy = status !== 'idle'
  const canSend = text.trim().length > 0 && !busy

  const submit = () => {
    if (!canSend) return
    const id = send(conversationId, text, projectId)
    setText('')
    setMultiline(false)
    if (conversationId === null && id) onSent?.(id)
  }

  return (
    <div
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setFocused(false)
      }}
      // The radius is a real style with a CSS transition, not a Framer
      // `animate`. A Framer value is only applied once the animation loop
      // runs, so the resting shape of the most important control in the app
      // would depend on frames being scheduled -- and it renders as a square
      // box in any situation where they are not. CSS interpolates one property
      // just as well and always paints the correct shape on the first frame.
      // The shape and the height both change together on send/past. Animating
      // only the shadow keeps them on the same clock -- a radius animation that
      // outlasts an instant height change is the capsule that never finishes
      // reshaping itself. The shadow is what gives the lift, and it does not
      // fight the textarea's own height.
      style={{
        paddingInline: COMPOSER.paddingInline,
        borderRadius: multiline ? COMPOSER.multilineRadius : RADIUS.pill,
        transitionDuration: `${DURATION.base}s`,
      }}
      className={cn(
        'bg-surface-raised py-1.5',
        // Both properties, or the radius does not animate at all: naming only
        // `box-shadow` sets `transition-property` to exactly that, so the
        // capsule-to-box change snapped a frame after the field had already
        // grown. That mismatch -- height first, shape a frame later -- is what
        // read as the composer changing shape and correcting itself on paste.
        'transition-[box-shadow,border-radius] ease-out',
        focused
          ? 'shadow-[0_2px_10px_rgba(0,0,0,0.07),0_0_0_1px_rgba(0,0,0,0.07)]'
          : 'shadow-[0_2px_10px_rgba(0,0,0,0.05),0_0_0_1px_rgba(0,0,0,0.045)]',
        'dark:shadow-[0_2px_12px_rgba(0,0,0,0.34),0_0_0_1px_rgba(255,255,255,0.07)]',
      )}
    >
      {/* `items-end` while multiline so the buttons stay level with the last
          line rather than floating beside the middle of a tall field.
          `items-center` on one line is what actually centres the glyphs, and
          the mismatch between those two was the misalignment in the last pass. */}
      <div className={cn('flex gap-1', multiline ? 'items-end' : 'items-center')}>
        <AddMenu onDictate={focus} />

        <div className="min-w-0 flex-1">
          <ComposerField
            handleRef={field}
            value={text}
            onChange={setText}
            onSubmit={submit}
            onMultilineChange={setMultiline}
            placeholder={placeholder}
          />
        </div>

        <div className="flex items-center gap-0.5">
          <AnimatePresence initial={false}>
            {canSend || busy ? (
              <motion.div
                key="send"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              >
                <IconButton
                  label={busy ? 'Stop' : 'Send'}
                  size="lg"
                  round
                  tone="solid"
                  onClick={busy ? stop : submit}
                >
                  {busy ? <Icons.stop /> : <Icons.send size="md" />}
                </IconButton>
              </motion.div>
            ) : (
              <motion.div
                key="voice"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              >
                {/* Voice mode, not dictation. Dictation turns speech into text
                    in this field and lives in the plus menu; this starts a
                    spoken conversation and replaces the field entirely. Two
                    features, so two marks -- the previous build gave them
                    adjacent glyphs and they read as one control with a
                    duplicate. */}
                <IconButton label="Voice mode" size="lg" round onClick={() => undefined}>
                  <Icons.voice size="md" />
                </IconButton>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
