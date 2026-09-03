import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COMPOSER, DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import {
  MAX_IMAGES_PER_TURN,
  pickImageFiles,
  readImageFile,
  type ImageRejection,
} from '@/domain/attachments/images'
import { AddMenu } from '@/features/chat/composer/AddMenu'
import { PendingImages } from '@/features/chat/composer/PendingImages'
import { PermissionControl } from '@/features/chat/composer/PermissionControl'
import { ComposerField, type ComposerFieldHandle } from '@/features/chat/composer/ComposerField'
import { clearDraft, readDraft, writeDraft } from '@/features/chat/composer/drafts'
import { useTypeToFocus } from '@/features/chat/composer/useTypeToFocus'
import { DictationBar, useDictation } from '@/features/voice'
import { useVoiceModeContext } from '@/features/voice'
import { useWorkspace } from '@/stores/workspace'
import type { TurnImageWire } from '@/platform/harness'
import { cn } from '@/lib/cn'

/*
 * One clock for the whole reshape.
 *
 * The capsule becoming a box is four motions at once: the field's height, the
 * footer track growing in, the controls relocating and the frame's radius
 * relaxing. All four share `DURATION.slow` and the house ease-out — the
 * vocabulary's "a whole surface changing" — because when they run on
 * different clocks the parts read as separate events happening near each
 * other, which is what an unanimated instant change degenerates into the
 * moment only some of it is animated.
 *
 * The shared curve is also what makes the relocation *compose* rather than
 * add: Framer animates the controls' offset from where the grid just placed
 * them, and the grid's own track grows under them by the same amount on the
 * same curve — the offset shrinks exactly as the track rises, so the two
 * read as one continuous glide.
 */
const SHAPE_MOTION = { duration: DURATION.slow, ease: EASE_OUT }
const TRACK_TRANSITION = `grid-template-rows ${DURATION.slow}s cubic-bezier(${EASE_OUT.join(', ')})`
/**
 * The footer track: the air above the controls plus the control row itself,
 * as one number. Carrying the air *in the track* — rather than as a row gap
 * — is what lets the track transition its height: a gap between rows appears
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
 * three moved to the top strip, because they are session facts — who you are
 * talking to and what it may do — rather than properties of the sentence you
 * are writing. Kept here they turned the field into a toolbar, which is the
 * single loudest way a text box stops looking calm.
 *
 * What is left is what genuinely belongs to this message: what to add to it,
 * and whether to send it.
 *
 * ---- Where a send goes -----------------------------------------------------
 *
 * Anywhere a message can reach the harness, it does, and the caller says so
 * by passing `onSend`/`busy`/`onStop`: the text leaves for the harness, stop
 * aborts the RUN (the only thing that means abort), and this component never
 * learns more about either than that. That is every conversation, and — since
 * Task 33 — home and a project page too, where a send starts a conversation
 * by admitting its first turn before anything is created or navigated to.
 *
 * The default path, the workspace store's local demo turn, has exactly one
 * caller left: the artifact gallery, which is a display of stages no harness
 * produces rather than a conversation with an agent. It was the default for
 * the two entry points as well, which meant every conversation in the app
 * began with a turn that never left the window. Two transports, one control.
 *
 * A live send answers with a receipt, and the field holds the words until
 * the receipt says the harness took them. Clearing optimistically turned a
 * refused POST into a silent swallow — the message vanished, nothing
 * anywhere said why, and the person retyped it into a connection that would
 * refuse it again. Now a refusal leaves the text exactly where it was, with
 * the notice explaining itself above this component.
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
  placeholder,
  onSent,
  onSend,
  busy: busyOverride,
  onStop,
}: {
  conversationId: string | null
  placeholder: string
  onSent?: (conversationId: string) => void
  /**
   * When present, sends go here instead of the demo turn runner. The answer
   * is a receipt, not a fire-and-forget: the field clears only when `ok`
   * says the harness took the message.
   */
  /**
   * When present, sends go here instead of the demo turn runner. The answer
   * is a receipt, not a fire-and-forget: the field clears only when `ok`
   * says the harness took the message. The images beside the words clear
   * with the same rule — they belong to this message, and stay when the
   * field still holds words the receipt did not take.
   */
  onSend?: (text: string, images: readonly TurnImageWire[]) => Promise<{ readonly ok: boolean }>
  /** Overrides the demo busy state while `onSend` owns sending. */
  busy?: boolean
  /** Aborts the harness run; only meaningful with `onSend`. */
  onStop?: () => void
}) {
  const { status, send, stop } = useWorkspace()
  // Seeded from the stored draft rather than the empty string. An async read
  // would mount the field blank and fill it a frame later, which reads as the
  // app losing the sentence and then changing its mind.
  const [text, setTextState] = useState(() => readDraft(conversationId))
  // Mirror of `text` for callbacks that must judge the CURRENT field against
  // what was sent — the closure below would otherwise see the render in
  // which the send began.
  const textRef = useRef('')
  textRef.current = text
  /**
   * Every path that changes the field records the draft.
   *
   * Wrapping the setter rather than watching `text` with an effect keeps the
   * two in step for changes that never touch `onChange` — dictation appends
   * through the updater form, and it is exactly the long, spoken, expensive
   * message a person would most hate to lose.
   *
   * The updater form is resolved here against `textRef` rather than inside
   * `setTextState`, because the draft write is a side effect and React may
   * call a state updater more than once.
   */
  const setText = useCallback(
    (next: string | ((current: string) => string)) => {
      const resolved = typeof next === 'function' ? next(textRef.current) : next
      textRef.current = resolved
      setTextState(resolved)
      writeDraft(conversationId, resolved)
    },
    [conversationId],
  )
  /**
   * The images riding on this message, already read and encoded. The ref is
   * the receipt check's twin of `textRef`: a send clears them only when the
   * strip still holds exactly what that receipt took, so images picked
   * during the round trip belong to the next message.
   */
  const [images, setImages] = useState<readonly TurnImageWire[]>([])
  const imagesRef = useRef<readonly TurnImageWire[]>([])
  imagesRef.current = images
  /** Pick-time rejections, held until the next pick or a successful send. */
  const [refusals, setRefusals] = useState<readonly ImageRejection[]>([])
  const picker = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [multiline, setMultiline] = useState(false)
  // True from send to receipt. Without it a refused send left `busy` false
  // for the whole round trip, so a second click could start a second POST
  // while the first was still being judged.
  const [sending, setSending] = useState(false)
  const field = useRef<ComposerFieldHandle>(null)
  const voice = useVoiceModeContext()

  const dictation = useDictation({
    // Appended, not assigned: dictation is one input among several, and a
    // sentence typed before speaking is not made wrong by being spoken after.
    onText: (spoken) =>
      setText((current) => (current.trim().length > 0 ? `${current.trimEnd()} ${spoken}` : spoken)),
  })

  // Coming out of dictation, the caret goes back where it was — the field
  // remounts as the strip leaves, so the focus has to wait for the return
  // rather than firing from the hook's completion.
  const wasDictating = useRef(false)
  useEffect(() => {
    if (dictation.stage === 'idle' && wasDictating.current) field.current?.focus()
    wasDictating.current = dictation.stage !== 'idle'
  }, [dictation.stage])

  const focus = useCallback(() => field.current?.focus(), [])
  useTypeToFocus(true, focus)

  const live = onSend !== undefined
  // OR, never a fallback. The page passes a boolean for the whole POST round
  // trip — `false`, because the turn has not started streaming yet — so
  // `busyOverride ?? sending` would never reach `sending` where it is wired,
  // and the in-flight lock would exist only for callers that omit the prop.
  const busy = live ? (busyOverride ?? false) || sending : status !== 'idle'
  const canSend = (text.trim().length > 0 || images.length > 0) && !busy
  const dictating = dictation.stage !== 'idle'

  /**
   * Reads the picker's haul into the strip: rules first, then bytes. The
   * cap counts the turn, so a second pick that would overrun fills the
   * rejections line instead of silently dropping.
   */
  const addImages = useCallback((picked: readonly File[]) => {
    const { accepted, rejections: judged } = pickImageFiles(picked, imagesRef.current.length)
    void Promise.all(accepted.map(readImageFile)).then((outcomes) => {
      const read: TurnImageWire[] = []
      const held: ImageRejection[] = [...judged]
      for (const outcome of outcomes) {
        if ('type' in outcome) read.push(outcome)
        else held.push(outcome)
      }
      setRefusals(held)
      if (read.length === 0) return
      setImages((current) => [...current, ...read].slice(0, MAX_IMAGES_PER_TURN))
    })
  }, [])

  const removeImage = useCallback((index: number) => {
    setImages((current) => current.filter((_, at) => at !== index))
  }, [])

  const submit = () => {
    if (!canSend) return
    if (live && onSend !== undefined) {
      const outgoing = text
      const carried = images
      setSending(true)
      void onSend(outgoing, carried).then(
        (receipt) => {
          setSending(false)
          // Clear only what the harness actually took, and only if the
          // field still holds exactly that — words typed during the round
          // trip belong to the next message, not this receipt. Same for the
          // strip: a different array is a different message being built.
          if (!receipt.ok || textRef.current !== outgoing || imagesRef.current !== carried) {
            return
          }
          setText('')
          // Written out now rather than after the quiet window. A quit inside
          // that window would otherwise restore words the harness already
          // took, which reads as the app duplicating the message.
          clearDraft(conversationId)
          setMultiline(false)
          setImages([])
          setRefusals([])
        },
        () => {
          // A send that threw instead of answering is not an acceptance
          // either. The words stay, exactly as for an explicit refusal.
          setSending(false)
        },
      )
      return
    }
    const id = send(conversationId, text)
    setText('')
    clearDraft(conversationId)
    setImages([])
    setRefusals([])
    setMultiline(false)
    if (conversationId === null && id) onSent?.(id)
  }

  const halt = () => {
    if (live) {
      onStop?.()
      return
    }
    stop()
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
      // would depend on frames being scheduled — and it renders as a square
      // box in any situation where they are not. CSS interpolates one property
      // just as well and always paints the correct shape on the first frame.
      // The duration is the reshape clock (`SHAPE_MOTION`): the height and
      // the footer track below animate on it too, and a radius on a shorter
      // one would finish early and leave a box still wearing capsule corners
      // — the same "changes shape and corrects itself" read this whole block
      // exists to prevent. The shadow is what gives the lift, and it does not
      // fight the textarea's own height.
      style={{
        paddingInline: COMPOSER.paddingInline,
        // Block padding is a token here rather than a `py-*` utility because
        // it is one of the two inputs the resting height is computed from —
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
        // — the point is that the surface acknowledges the caret arriving, not
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
        // is simply the size now. Focus is still acknowledged — by the shadow,
        // which costs no layout.
        // Both properties, or the radius does not animate at all: naming only
        // `box-shadow` sets `transition-property` to exactly that, so the
        // capsule-to-box change snapped a frame after the field had already
        // grown. That mismatch — height first, shape a frame later — is what
        // read as the composer changing shape and correcting itself on paste.
        'transition-[box-shadow,border-radius,padding]',
        // Both properties, or the radius does not animate at all: naming only
        // `box-shadow` sets `transition-property` to exactly that, so the
        // capsule-to-box change snapped a frame after the field had already
        // grown. That mismatch — height first, shape a frame later — is what
        // read as the composer changing shape and correcting itself on paste.
        // Two steps of the shared elevation scale rather than three hand-mixed
        // shadows. The third of those was the bug: `dark:shadow-[...]` had no
        // `focused` condition, so in dark mode it overrode *both* branches and
        // the field stopped lifting on focus entirely — the breathing worked in
        // light mode only. The scale carries its own dark values, so there is
        // nothing left here to get out of step.
        focused ? 'shadow-lifted' : 'shadow-raised',
      )}
    >
      {/* The images this message carries, above the words: content of the
          message, in the message's frame. The rejections under them are the
          pick's honest remainder — a file the rules refused, named where the
          person can still do something about it. */}
      <PendingImages images={images} onRemove={removeImage} />
      {refusals.length > 0 ? (
        <div className="mb-2" role="status">
          {refusals.map((entry, at) => (
            <p key={`${entry.filename}-${at}`} className="text-caption text-muted-foreground">
              {entry.filename} — {entry.reason}
            </p>
          ))}
        </div>
      ) : null}

      {/* One grid, two arrangements, the same three columns — and always two
          rows, so nothing has to appear or vanish. On one line the second
          track is zeroed and the clusters sit in the side columns with the
          field between them: the capsule, exactly the height its tokens say,
          everything on a single row. Past the first line the field takes the
          first row across all three columns and both clusters drop into the
          second track, a footer along the bottom of the frame — the text then
          wraps the full width of the field, and no line of it reaches the row
          the controls are on. While the buttons stayed beside the text, every
          wrapped line was squeezed into the width four controls left between
          them, and the buttons rode beside whichever line the caret was on.

          A grid rather than the row re-rendered two ways: the controls never
          move in the DOM, so nothing remounts and an open menu stays open, and
          the relocation hangs off the same `multiline` signal that reshapes
          the frame — the capsule-to-box radius and the footer cannot
          disagree about which state the field is in.

          The reshape is animated on the one clock, in two halves that meet.
          The track and the field's own height are CSS transitions, so the
          frame grows continuously. The controls are `layout="position"`:
          Framer glides them from where they were to where the grid has just
          slotted them, and — on the same curve — that glide cancels the
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
          {/* The image picker is this menu's one live item: the dialog it
              opens is the webview's own file input, no plugin. The demo
              transport carries only words, so on the gallery there is no
              handler to attach and the item closes as it always has. */}
          <AddMenu onImage={live ? () => picker.current?.click() : undefined} />

          {/* What Studio may do, next to the thing that will make it do it.
              The mode is the one setting whose consequence lands on the user's
              machine, and it is the one you reconsider while looking at what
              you are about to send — so it sits by the send button rather
              than three clicks deep in a menu in the window chrome. Mark only
              at rest; the name is a hover and a click away. With a live
              conversation it shows and settles that conversation's own stored
              mode; on the gallery and on home there is nothing stored, so it
              is the window's setting. */}
          <PermissionControl conversationId={live ? conversationId : null} />
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
              real level takes its place — same slot, same line height, so
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
                  note={dictation.note}
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
              It acts on this field — it fills it with what you say — so it
              belongs beside the field the way send does. Buried in a menu it
              was two clicks from the thing it modifies, and it was the only
              item in that menu that was not "attach something".

              The mark becomes the transport while recording: the mic gathers,
              the square stops. Same control, two states, one meaning — the
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
              no voice mode to offer — the strip is the message in progress,
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
                  onClick={busy ? halt : submit}
                >
                  {busy ? (
                    <>
                      <WorkingRing />
                      {/* `size="md"`, like every other mark in this row. It
                          was written without one, so it fell back to the
                          text-relative step and painted 10.4px inside a 22px
                          circle while its own siblings painted 14.8px — the
                          mark was centred to the pixel and still looked
                          wrong, because it was two thirds the size of the
                          arrow it replaced. It is a solid square now rather
                          than Lucide's outlined one, which is what the rest
                          of that complaint turned out to be about; see the
                          note above `TRANSPORT` in `drawn.tsx`. */}
                      <Icons.stop size="md" />
                    </>
                  ) : (
                    <Icons.send size="md" />
                  )}
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
                    features, so two marks — the previous build gave them
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

      {/* Off-flow and invisible: only its click handler matters, opened by
          the plus menu. `accept` narrows the dialog to the four formats the
          rules admit, and `multiple` matches the strip's count; the value is
          reset after each read so picking the same file twice still fires. */}
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (picked.length > 0) addImages(picked)
        }}
      />
    </div>
  )
}

/**
 * The turn is in flight: a ring travelling around the stop control.
 *
 * The button stays the stop button — that is the one thing it must remain
 * while a turn is running, and a spinner that replaced it would take away the
 * only way to call the turn back. The ring is drawn around it instead, so the
 * control's meaning is unchanged and the motion is the only thing added.
 *
 * It exists because the composer had no way of saying "sent, nothing back
 * yet". Measured on the real provider, that window is 2.7s on a small model
 * and 6 to 8s on a reasoning one, and for all of it the only sign anything
 * was happening lived in the transcript. A person who has just pressed send
 * is looking at the button they pressed.
 *
 * Indeterminate on purpose: nothing here knows how long the model will take,
 * so the ring reports activity and never progress. A bar that filled would be
 * inventing a fraction of a duration nobody has measured.
 *
 * ---- Why an arc rather than a bordered box ---------------------------------
 *
 * It was a `rounded-full` span with one lit border edge, hung on a wrapper
 * around the mark. Two things were wrong with that and they compounded. It
 * measured itself from the GLYPH — 10.4px of icon plus 5px of inset, landing
 * at 18px inside a 22px control — so it traced neither the mark nor the
 * button, and an arc that matches no edge on screen reads as a loose ring
 * rather than as the control's outline. And a border arc on a rounded box is
 * drawn by the box model: its ends are mitre cuts, and at this diameter the
 * curve is visibly a rounded rectangle pretending to be a circle.
 *
 * A stroked circle fixes both. `pathLength` normalises the circumference to
 * 100 so the dash is a plain percentage of the way round, round caps give the
 * arc ends instead of mitres, and `non-scaling-stroke` holds the line at
 * ~1.4px at every `--ui-size`, the way the icon set holds its own weight.
 *
 * ---- Outside the button, not inside it -------------------------------------
 *
 * It first went just INSIDE the rim, on the reasoning that a ring tracing the
 * edge reads as the button's own outline. On screen it does not: inside the
 * rim the arc shares its space with the mark, crowding a glyph that is
 * centred to the pixel into looking off-centre, and the control ends up with
 * something drawn on top of it rather than around it.
 *
 * Outside, it is unambiguously a halo: the button is untouched, the mark has
 * its whole circle back, and the moving part is clearly separate from the
 * thing you click. Nothing in the composer clips it — the frame, the grid and
 * the cell are all `overflow: visible` — so the few pixels it needs are there.
 */
function WorkingRing() {
  return (
    <motion.svg
      aria-hidden
      viewBox="0 0 24 24"
      // Hung on the IconButton, which is positioned for exactly this, and
      // grown past its edge. Not a flex item, so it cannot shift the mark it
      // travels around.
      className="pointer-events-none absolute -inset-[3px]"
      animate={{ rotate: 360 }}
      transition={{ duration: 1.1, ease: 'linear', repeat: Infinity }}
    >
      <circle
        cx="12"
        cy="12"
        // The box is the button plus 3px on every side, so the button's own
        // rim sits at r=10.24 in these units. This clears it with a little
        // air and still leaves room for the stroke inside the box.
        r="10.9"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        pathLength={100}
        // A quarter of the way round, with a gap for the rest. Long enough to
        // read as travelling, short enough that the gap is what the eye
        // follows.
        strokeDasharray="25 75"
        opacity={0.75}
      />
    </motion.svg>
  )
}
