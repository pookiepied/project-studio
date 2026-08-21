import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COMPOSER, DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { AddMenu } from '@/features/chat/composer/AddMenu'
import { PermissionControl } from '@/features/chat/composer/PermissionControl'
import { ComposerField, type ComposerFieldHandle } from '@/features/chat/composer/ComposerField'
import { useTypeToFocus } from '@/features/chat/composer/useTypeToFocus'
import { DictationBar, useDictation } from '@/features/voice'
import { useVoiceModeContext } from '@/features/voice'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

/*
 * One clock for the whole reshape.
 *
 * The capsule becoming a box is four motions at once: the field's height, the
 * footer track growing in, the controls relocating and the frame's radius
 * relaxing. All four share `DURATION.slow` and the house ease-out -- the
 * vocabulary's "a whole surface changing" -- because when they run on
 * different clocks the parts read as separate events happening near each
 * other, which is what an unanimated instant change degenerates into the
 * moment only some of it is animated.
 *
 * The shared curve is also what makes the relocation *compose* rather than
 * add: Framer animates the controls' offset from where the grid just placed
 * them, and the grid's own track grows under them by the same amount on the
 * same curve -- the offset shrinks exactly as the track rises, so the two
 * read as one continuous glide.
 */
const SHAPE_MOTION = { duration: DURATION.slow, ease: EASE_OUT }
const TRACK_TRANSITION = `grid-template-rows ${DURATION.slow}s cubic-bezier(${EASE_OUT.join(', ')})`
/**
 * The footer track: the air above the controls plus the control row itself,
 * as one number. Carrying the air *in the track* -- rather than as a row gap
 * -- is what lets the track transition its height: a gap between rows appears
 * at full size the moment a second row exists, which is a step in the frame's
 * bottom edge no matter how smoothly everything else moves.
 */
const FOOTER_TRACK = 'auto calc(var(--control-md) + 0.5rem)'

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
  const voice = useVoiceModeContext()

  const dictation = useDictation({
    // Appended, not assigned: dictation is one input among several, and a
    // sentence typed before speaking is not made wrong by being spoken after.
    onText: (spoken) =>
      setText((current) => (current.trim().length > 0 ? `${current.trimEnd()} ${spoken}` : spoken)),
  })

  // Coming out of dictation, the caret goes back where it was -- the field
  // remounts as the strip leaves, so the focus has to wait for the return
  // rather than firing from the hook's completion.
  const wasDictating = useRef(false)
  useEffect(() => {
    if (dictation.stage === 'idle' && wasDictating.current) field.current?.focus()
    wasDictating.current = dictation.stage !== 'idle'
  }, [dictation.stage])

  const focus = useCallback(() => field.current?.focus(), [])
  useTypeToFocus(true, focus)

  const busy = status !== 'idle'
  const canSend = text.trim().length > 0 && !busy
  const dictating = dictation.stage !== 'idle'

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
      // The duration is the reshape clock (`SHAPE_MOTION`): the height and
      // the footer track below animate on it too, and a radius on a shorter
      // one would finish early and leave a box still wearing capsule corners
      // -- the same "changes shape and corrects itself" read this whole block
      // exists to prevent. The shadow is what gives the lift, and it does not
      // fight the textarea's own height.
      style={{
        paddingInline: COMPOSER.paddingInline,
        // Block padding is a token here rather than a `py-*` utility because
        // it is one of the two inputs the resting height is computed from --
        // see `COMPOSER_RESTING_HEIGHT`. As a class it was a third number that
        // had to be kept in step with the other two by hand, and it was the
        // one that silently disagreed: the field measured 52 while the token
        // said what it should be.
        paddingBlock: COMPOSER.paddingBlock,
        borderRadius: multiline ? COMPOSER.multilineRadius : COMPOSER.restingRadius,
        transitionDuration: `${DURATION.slow}s`,
        transitionTimingFunction: `cubic-bezier(${EASE_OUT.join(', ')})`,
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
        // Both properties, or the radius does not animate at all: naming only
        // `box-shadow` sets `transition-property` to exactly that, so the
        // capsule-to-box change snapped a frame after the field had already
        // grown. That mismatch -- height first, shape a frame later -- is what
        // read as the composer changing shape and correcting itself on paste.
        'transition-[box-shadow,border-radius,padding]',
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
      {/* One grid, two arrangements, the same three columns -- and always two
          rows, so nothing has to appear or vanish. On one line the second
          track is zeroed and the clusters sit in the side columns with the
          field between them: the capsule, exactly the height its tokens say,
          everything on a single row. Past the first line the field takes the
          first row across all three columns and both clusters drop into the
          second track, a footer along the bottom of the frame -- the text then
          wraps the full width of the field, and no line of it reaches the row
          the controls are on. While the buttons stayed beside the text, every
          wrapped line was squeezed into the width four controls left between
          them, and the buttons rode beside whichever line the caret was on.

          A grid rather than the row re-rendered two ways: the controls never
          move in the DOM, so nothing remounts and an open menu stays open, and
          the relocation hangs off the same `multiline` signal that reshapes
          the frame -- the capsule-to-box radius and the footer cannot
          disagree about which state the field is in.

          The reshape is animated on the one clock, in two halves that meet.
          The track and the field's own height are CSS transitions, so the
          frame grows continuously. The controls are `layout="position"`:
          Framer glides them from where they were to where the grid has just
          slotted them, and -- on the same curve -- that glide cancels the
          instant re-slotting underneath it. Position only, never a full
          `layout`: size changes would be scale, and a scaled field stretches
          the text it holds while its width moves. Reduced motion collapses
          both halves to the end state, one via MotionConfig and one via the
          global media query. */}
      <div
        style={{
          gridTemplateRows: multiline ? FOOTER_TRACK : 'auto 0px',
          transition: TRACK_TRANSITION,
        }}
        className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0"
      >
        <motion.div
          layout="position"
          transition={SHAPE_MOTION}
          className={cn(
            'col-start-1 flex items-center gap-1',
            multiline ? 'row-start-2 self-end' : 'row-start-1',
          )}
        >
          <AddMenu />

          {/* What Studio may do, next to the thing that will make it do it.
              The mode is the one setting whose consequence lands on the user's
              machine, and it is the one you reconsider while looking at what
              you are about to send -- so it sits by the send button rather
              than three clicks deep in a menu in the window chrome. Mark only
              at rest; the name is a hover and a click away. */}
          <PermissionControl />
        </motion.div>

        <motion.div
          layout="position"
          transition={SHAPE_MOTION}
          className={cn(
            'row-start-1 min-w-0',
            multiline ? 'col-start-1 col-span-3' : 'col-start-2',
          )}
        >
          {/* While dictation is live the field steps aside and the strip of
              real level takes its place -- same slot, same line height, so
              the capsule neither grows nor reshapes. `popLayout` keeps the
              outgoing field in the flow's memory for the length of its exit
              rather than collapsing the row for one frame. */}
          <AnimatePresence initial={false} mode="popLayout">
            {dictating ? (
              <motion.div
                key="dictation"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              >
                <DictationBar
                  stage={dictation.stage}
                  elapsedMs={dictation.elapsedMs}
                  denied={dictation.denied}
                  onFrame={dictation.mic.onFrame}
                />
              </motion.div>
            ) : (
              <motion.div
                key="field"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              >
                <ComposerField
                  handleRef={field}
                  value={text}
                  onChange={setText}
                  onSubmit={submit}
                  onMultilineChange={setMultiline}
                  multiline={multiline}
                  placeholder={placeholder}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <motion.div
          layout="position"
          transition={SHAPE_MOTION}
          className={cn(
            'flex items-center gap-1',
            multiline ? 'col-start-3 row-start-2 self-end' : 'col-start-3 row-start-1',
          )}
        >
          {/* Dictation sits in the field, not in the plus menu.
              It acts on this field -- it fills it with what you say -- so it
              belongs beside the field the way send does. Buried in a menu it
              was two clicks from the thing it modifies, and it was the only
              item in that menu that was not "attach something".

              The mark becomes the transport while recording: the mic gathers,
              the square stops. Same control, two states, one meaning -- the
              way send becomes stop while a reply streams. */}
          <IconButton
            label={dictation.stage === 'recording' ? 'Stop and transcribe' : 'Dictate'}
            size="md"
            active={dictation.stage === 'recording'}
            disabled={dictation.stage === 'requesting' || dictation.stage === 'processing'}
            onClick={() =>
              dictation.stage === 'recording' ? void dictation.stop() : void dictation.start()
            }
          >
            {dictation.stage === 'recording' ? <Icons.stop size="md" /> : <Icons.dictate size="md" />}
          </IconButton>

          {/* While the microphone owns the field there is nothing to send and
              no voice mode to offer -- the strip is the message in progress,
              and the mic beside it is its only control. */}
          {!dictating && (
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
                  size="md"
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
                    in this field and lives beside it; this starts a
                    spoken conversation and replaces the field entirely. Two
                    features, so two marks -- the previous build gave them
                    adjacent glyphs and they read as one control with a
                    duplicate. */}
                <IconButton label="Voice mode" size="md" onClick={voice.enter}>
                  <Icons.voice size="md" />
                </IconButton>
              </motion.div>
            )}
          </AnimatePresence>
          )}
        </motion.div>
      </div>
    </div>
  )
}
