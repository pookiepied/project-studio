import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COMPOSER, DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { AddMenu } from '@/features/chat/composer/AddMenu'
import { PermissionControl } from '@/features/chat/composer/PermissionControl'
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
        borderRadius: multiline ? COMPOSER.multilineRadius : COMPOSER.restingRadius,
        transitionDuration: `${DURATION.base}s`,
      }}
      className={cn(
        'bg-surface-raised',
        // The field breathes on focus: a little taller, lifted a little further
        // off the page. Both are small enough to register without being watched
        // -- the point is that the surface acknowledges the caret arriving, not
        // that it performs. A control this central looking identical whether or
        // not it is ready for typing is the specific thing that made the page
        // read as a picture of an app rather than one you are using.
        // One height, always the taller one.
        //
        // The field used to grow on focus. It was the right instinct and the
        // wrong mechanism: the control at the centre of the page changing size
        // when the caret arrives means the page reflows every time you click
        // into it, and on paste the height and the radius resolved a frame
        // apart, which is what read as the composer changing shape and
        // correcting itself. The roomier size was better in both states, so it
        // is simply the size now. Focus is still acknowledged -- by the shadow,
        // which costs no layout.
        'py-2.5',
        'transition-[box-shadow,border-radius,padding] duration-base ease-out',
        // Both properties, or the radius does not animate at all: naming only
        // `box-shadow` sets `transition-property` to exactly that, so the
        // capsule-to-box change snapped a frame after the field had already
        // grown. That mismatch -- height first, shape a frame later -- is what
        // read as the composer changing shape and correcting itself on paste.
        // Two steps of the shared elevation scale rather than three hand-mixed
        // shadows. The third of those was the bug: `dark:shadow-[...]` had no
        // `focused` condition, so in dark mode it overrode *both* branches and
        // the field stopped lifting on focus entirely -- the breathing worked in
        // light mode only. The scale carries its own dark values, so there is
        // nothing left here to get out of step.
        focused ? 'shadow-lifted' : 'shadow-raised',
      )}
    >
      {/* `items-end` while multiline so the buttons stay level with the last
          line rather than floating beside the middle of a tall field.
          `items-center` on one line is what actually centres the glyphs, and
          the mismatch between those two was the misalignment in the last pass. */}
      <div className={cn('flex gap-1', multiline ? 'items-end' : 'items-center')}>
        <AddMenu />

        {/* What Studio may do, next to the thing that will make it do it.
            The mode is the one setting whose consequence lands on the user's
            machine, and it is the one you reconsider while looking at what you
            are about to send -- so it sits by the send button rather than
            three clicks deep in a menu in the window chrome. Mark only at
            rest; the name is a hover and a click away. */}
        <PermissionControl />

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
          {/* Dictation sits in the field, not in the plus menu.
              It acts on this field -- it fills it with what you say -- so it
              belongs beside the field the way send does. Buried in a menu it
              was two clicks from the thing it modifies, and it was the only
              item in that menu that was not "attach something". */}
          <IconButton label="Dictate" size="lg" onClick={focus}>
            <Icons.dictate size="md" />
          </IconButton>

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
                <IconButton label="Voice mode" size="lg" onClick={() => undefined}>
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
