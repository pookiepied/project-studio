import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COMPOSER, DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import {
  pickImageFiles,
  readImageFile,
  type ImageRejection,
} from '@/domain/attachments/images'
import { AddMenu } from '@/features/chat/composer/AddMenu'
import { PendingImages } from '@/features/chat/composer/PendingImages'
import { PendingDocuments } from '@/features/chat/composer/PendingDocuments'
import { DOCUMENT_ACCEPT, documentMimeOf, pickDocumentFiles } from '@/domain/attachments/documents'
import { DUPLICATE_ATTACHMENT_NOTE, matchingDocument } from '@/domain/attachments/duplicates'
import { base64OfBytes } from '@/lib/base64'
import { KeepDialog } from '@/features/library/KeepDialog'
import type { KeepCandidate } from '@/features/library/client'
import { PermissionControl } from '@/features/chat/composer/PermissionControl'
import { ComposerField, type ComposerFieldHandle } from '@/features/chat/composer/ComposerField'
import { clearDraft, readDraft, writeDraft } from '@/features/chat/composer/drafts'
import { useTypeToFocus } from '@/features/chat/composer/useTypeToFocus'
import { ImproveButton } from '@/features/chat/composer/ImproveButton'
import { useImproveOffer } from '@/features/chat/composer/useImproveOffer'
import { SlashSuggestions } from '@/features/chat/composer/SlashSuggestions'
import { useSlashCommands } from '@/features/chat/composer/useSlashCommands'
import { DictationBar, TextLanding, landingDuration, useDictation } from '@/features/voice'
import { useVoiceModeContext, voiceInputAvailable, VOICE_UNAVAILABLE_REASON } from '@/features/voice'
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
 * The field's side insets, on the same clock. The field spans the whole
 * frame in both arrangements; what changes is how much of each side it
 * leaves to the clusters beside it - their widths on one line, nothing once
 * they have dropped to the footer. Padding is a length CSS interpolates, so
 * the text's left edge and its wrapping width glide from one to the other
 * as the clusters descend, instead of the field jumping columns and its
 * text re-wrapping on the first frame while the rest of the frame was
 * still moving. A grid column is not a length, and that jump was the
 * moment that read as the composer distorting before it animated.
 */
const INSET_TRANSITION = `padding ${DURATION.slow}s cubic-bezier(${EASE_OUT.join(', ')})`
/** The grid's column gap (`gap-x-2`), which the insets have to include. */
const CLUSTER_GAP = 8
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
 * To the harness, always, through `onSend`: the text leaves for the harness,
 * stop aborts the RUN (the only thing that means abort), and this component
 * never learns more about either than that. That is every conversation, and
 * home and a project page too, where a send starts a conversation by
 * admitting its first turn before anything is created or navigated to.
 *
 * There used to be a second transport underneath -- the workspace store's
 * local demo turn, which typed a canned reply into a record -- and for a
 * while it was the default, so every conversation in the app began with a
 * turn that never left the window. Its last caller was the artifact gallery,
 * which has no composer now: a display of artifacts has nothing to answer.
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
  onSend,
  busy: turnRunning = false,
  allowSteering = false,
  onQueue,
  queueFull = false,
  restoredMessage,
  onStop,
}: {
  conversationId: string | null
  placeholder: string
  /**
   * Where a send goes. The answer is a receipt, not a fire-and-forget: the
   * field clears only when `ok` says the harness took the message. The
   * images beside the words clear with the same rule — they belong to this
   * message, and stay when the field still holds words the receipt did not
   * take. The documents ride the same call as the files they still are:
   * the page uploads them ahead of the words, because the engine carries
   * pictures on the message and nothing else.
   */
  onSend: (
    text: string,
    images: readonly TurnImageWire[],
    documents: readonly File[],
  ) => Promise<{ readonly ok: boolean }>
  /** The harness has a turn of ours: admitted, not yet settled. */
  busy?: boolean
  allowSteering?: boolean
  queueFull?: boolean
  restoredMessage?: { readonly submissionId: string; readonly text: string; readonly images: readonly TurnImageWire[] } | null
  onQueue?: (text: string, images: readonly TurnImageWire[], documents: readonly File[]) => Promise<{ readonly ok: boolean }>
  /** Aborts the harness run. */
  onStop?: () => void
}) {
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
  const [images, setImagesState] = useState<readonly TurnImageWire[]>([])
  // The picture being offered to the library, while its dialog is open.
  // Keeping does not touch the message: the strip still carries the image.
  const [keeping, setKeeping] = useState<KeepCandidate | null>(null)
  const imagesRef = useRef<readonly TurnImageWire[]>(images)
  const setImages = useCallback((next: readonly TurnImageWire[] | ((current: readonly TurnImageWire[]) => readonly TurnImageWire[])) => {
    const resolved = typeof next === 'function' ? next(imagesRef.current) : next
    imagesRef.current = resolved
    setImagesState(resolved)
  }, [])
  /**
   * The documents riding on this message, still as the files the picker
   * gave: bytes are compared only against possible duplicates, and each is
   * uploaded at send time. The ref is the receipt check's twin, as for images.
   */
  const [documents, setDocumentsState] = useState<readonly File[]>([])
  const [pendingAttachments, setPendingAttachments] = useState(0)
  // Serialize picks so two reads that overlap cannot both admit the same file.
  const attachmentReads = useRef<Promise<void>>(Promise.resolve())
  const documentsRef = useRef<readonly File[]>(documents)
  const setDocuments = useCallback((next: readonly File[] | ((current: readonly File[]) => readonly File[])) => {
    const resolved = typeof next === 'function' ? next(documentsRef.current) : next
    documentsRef.current = resolved
    setDocumentsState(resolved)
  }, [])
  /** Pick-time rejections, held until the next pick or a successful send. */
  const [refusals, setRefusals] = useState<readonly ImageRejection[]>([])
  const picker = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [multiline, setMultiline] = useState(false)
  // How much room each cluster takes beside the field on one line. Measured
  // from the clusters themselves rather than summed from tokens, because the
  // right one changes width - Improve arrives, the voice reason stands in.
  const leftCluster = useRef<HTMLDivElement>(null)
  const rightCluster = useRef<HTMLDivElement>(null)
  const [inset, setInset] = useState({ left: 0, right: 0 })
  useLayoutEffect(() => {
    const left = leftCluster.current
    const right = rightCluster.current
    if (!left || !right) return
    const read = () => {
      const next = {
        left: left.getBoundingClientRect().width + CLUSTER_GAP,
        right: right.getBoundingClientRect().width + CLUSTER_GAP,
      }
      setInset((current) =>
        current.left === next.left && current.right === next.right ? current : next,
      )
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(left)
    observer.observe(right)
    return () => observer.disconnect()
  }, [])
  // True from send to receipt. Without it a refused send left `busy` false
  // for the whole round trip, so a second click could start a second POST
  // while the first was still being judged.
  const [sending, setSending] = useState(false)
  const field = useRef<ComposerFieldHandle>(null)
  const restoredId = useRef<string | null>(null)
  useEffect(() => {
    if (!restoredMessage || restoredId.current === restoredMessage.submissionId) return
    restoredId.current = restoredMessage.submissionId
    // Keep any draft already being written while restoring the edited input.
    setText((current) => current ? `${restoredMessage.text}\n\n${current}` : restoredMessage.text)
    setImages((current) => [...restoredMessage.images, ...current])
    field.current?.focus()
  }, [restoredMessage, setText, setImages])
  // The frame itself, which the slash picker opens above — see
  // `SlashSuggestions` for why the panel is not part of this box.
  const frame = useRef<HTMLDivElement>(null)
  const voice = useVoiceModeContext()

  // Whether the mic is ours to ask for here (plan §3.7): read per render,
  // so the composer answers the origin it is actually on.
  const voiceAvailable = voiceInputAvailable()

  /**
   * A passage arriving in the field, shown arriving. While this holds text
   * the field's slot plays `TextLanding` over it, for as long as the words
   * take to rise; then the field returns holding the same words, and the
   * caret with it. Both whole-passage writes go through here - a take
   * landing and Improve's rewrite - so the composer has one way a passage
   * arrives, and a paste stays what it is.
   */
  const [landing, setLanding] = useState<string | null>(null)
  const landingTimer = useRef<number | null>(null)
  const land = useCallback((passage: string) => {
    if (landingTimer.current !== null) window.clearTimeout(landingTimer.current)
    setLanding(passage)
    landingTimer.current = window.setTimeout(() => {
      landingTimer.current = null
      setLanding(null)
    }, landingDuration(passage) * 1000)
  }, [])
  useEffect(
    () => () => {
      if (landingTimer.current !== null) window.clearTimeout(landingTimer.current)
    },
    [],
  )

  // The offer to tidy the message once a take has landed in it. It rewrites
  // the whole field, and its rewrite lands the way the take did.
  const improveOffer = useImproveOffer({ text, setText, onImproved: land })

  const dictation = useDictation({
    // Appended, not assigned: dictation is one input among several, and a
    // sentence typed before speaking is not made wrong by being spoken after.
    // The whole take arrives at once, when it ends; nothing lands mid-take.
    onTake: (spoken) => {
      const next = textRef.current.trim().length > 0 ? `${textRef.current.trimEnd()} ${spoken}` : spoken
      setText(next)
      land(next)
      improveOffer.open()
    },
  })

  // A take starting withdraws the last offer until this one lands. The
  // caret returns with the field, after the landing - see below.
  const wasDictating = useRef(false)
  useEffect(() => {
    if (dictation.stage === 'requesting') improveOffer.close()
    if (dictation.stage === 'idle' && wasDictating.current && landing === null) field.current?.focus()
    wasDictating.current = dictation.stage !== 'idle'
    // The offer's callbacks are stable; the stage is the one input here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.stage])

  // The field remounts as the landing leaves, so the caret has to wait for
  // the return rather than firing from the hook's completion.
  const wasLanding = useRef(false)
  useEffect(() => {
    if (landing === null && wasLanding.current) field.current?.focus()
    wasLanding.current = landing !== null
  }, [landing])

  const focus = useCallback(() => field.current?.focus(), [])
  useTypeToFocus(true, focus)

  // The slash: the picker while a name is typed, and what a command does
  // when sent. A refused action - "/compact" under the cool-down - leaves
  // its sentence here, in the place the picker's refusals take.
  const slash = useSlashCommands(text, conversationId)
  const [commandNote, setCommandNote] = useState<string | null>(null)
  const actionInFlight = useRef(false)
  const runAction = (message: string) => {
    if (sending || actionInFlight.current) return
    actionInFlight.current = true
    setSending(true)
    setCommandNote(null)
    setText('')
    clearDraft(conversationId)
    setMultiline(false)
    void slash.resolve(message).then(
      (outcome) => {
        if (outcome.kind === 'done') setCommandNote(outcome.note)
      },
      () => setCommandNote('The command could not be completed. Check the conversation before trying again.'),
    ).finally(() => {
      actionInFlight.current = false
      setSending(false)
    })
  }
  const pickSuggestion = (id: string, execute = true) => {
    if (execute && slash.isAction(`/${id}`)) {
      runAction(`/${id}`)
      return
    }
    setText(`/${id} `)
    setCommandNote(null)
  }
  const slashKey = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const rows = slash.suggestions
    if (rows === null || rows.length === 0 || event.nativeEvent.isComposing) return false
    if (event.key === 'ArrowDown') {
      slash.setSelected((slash.selected + 1) % rows.length)
      return true
    }
    if (event.key === 'ArrowUp') {
      slash.setSelected((slash.selected - 1 + rows.length) % rows.length)
      return true
    }
    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
      const picked = rows[slash.selected]
      if (picked === undefined) return false
      // A command that takes nothing is run on Enter, as it would be once
      // picked; Tab only completes the name either way.
      if (event.key === 'Enter' && picked.argumentHint === '' && text.trim() === `/${picked.id}`) {
        return false
      }
      pickSuggestion(picked.id, event.key === 'Enter')
      return true
    }
    if (event.key === 'Escape') {
      setText(text.trimEnd() + ' ')
      return true
    }
    return false
  }

  // Admission still locks duplicate sends. A running response instead offers
  // queue and steer, which have different delivery semantics in the harness.
  const busy = turnRunning || sending
  const canSend = (text.trim().length > 0 || images.length > 0 || documents.length > 0) &&
    !sending && pendingAttachments === 0 && (!turnRunning || allowSteering || onQueue !== undefined)
  const steering = turnRunning && allowSteering && canSend
  const dictating = dictation.stage !== 'idle'

  /**
   * Reads the picker's haul into the strip: rules first, then bytes. The
   * cap counts the turn, so a second pick that would overrun fills the
   * rejections line instead of silently dropping.
   */
  const addImages = useCallback((picked: readonly File[]) => {
    setPendingAttachments((count) => count + 1)
    attachmentReads.current = attachmentReads.current.then(async () => {
      const refused: ImageRejection[] = []
      for (const file of picked) {
        const judged = pickImageFiles([file])
        if (judged.accepted.length === 0) {
          refused.push(...judged.rejections)
          continue
        }
        const outcome = await readImageFile(file)
        if (!('type' in outcome)) {
          refused.push(outcome)
          continue
        }
        const current = imagesRef.current
        if (current.some((image) => image.data === outcome.data)) {
          refused.push({ filename: file.name, reason: DUPLICATE_ATTACHMENT_NOTE })
          continue
        }
        const room = pickImageFiles([file], current.length)
        if (room.accepted.length === 0) {
          refused.push(...room.rejections)
          continue
        }
        const next = [...current, outcome]
        setImages(next)
      }
      setRefusals((current) => [...current, ...refused])
    }).finally(() => setPendingAttachments((count) => count - 1))
  }, [setImages])

  const removeImage = useCallback((index: number) => {
    setImages((current) => current.filter((_, at) => at !== index))
  }, [setImages])

  /** Judges a haul of documents by name and size; the harness judges the bytes at the send. */
  const addDocuments = useCallback((picked: readonly File[]) => {
    setPendingAttachments((count) => count + 1)
    attachmentReads.current = attachmentReads.current.then(async () => {
      const refused: ImageRejection[] = []
      for (const file of picked) {
        const judged = pickDocumentFiles([file])
        if (judged.accepted.length === 0) {
          refused.push(...judged.rejections)
          continue
        }
        try {
          const duplicate = await matchingDocument(file, documentsRef.current)
          if (duplicate !== null && documentsRef.current.includes(duplicate)) {
            refused.push({ filename: file.name, reason: DUPLICATE_ATTACHMENT_NOTE })
            continue
          }
        } catch {
          refused.push({ filename: file.name, reason: 'Could not be read.' })
          continue
        }
        const current = documentsRef.current
        const room = pickDocumentFiles([file], current.length)
        if (room.accepted.length === 0) {
          refused.push(...room.rejections)
          continue
        }
        const next = [...current, file]
        setDocuments(next)
      }
      setRefusals((current) => [...current, ...refused])
    }).finally(() => setPendingAttachments((count) => count - 1))
  }, [setDocuments])

  const removeDocument = useCallback((index: number) => {
    setDocuments((current) => current.filter((_, at) => at !== index))
  }, [setDocuments])

  /**
   * Whatever the clipboard or a drag carries lands in a strip through the
   * same rules the picker uses -- judged, read, refused by name. A file is
   * a picture when the picker says so and a document when its name is one
   * the harness reads; anything else is refused by the picture rules, whose
   * sentence names the formats. Text pastes never reach here -- a clipboard
   * with files in it is an attachment event; a clipboard of words is the
   * field doing its job.
   */
  const ingestFiles = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return
      const pictures = files.filter((file) => file.type.startsWith('image/'))
      const papers = files.filter((file) => !file.type.startsWith('image/') && documentMimeOf(file.name) !== null)
      const neither = files.filter((file) => !pictures.includes(file) && !papers.includes(file))
      setRefusals([])
      if (pictures.length > 0 || neither.length > 0) addImages([...pictures, ...neither])
      if (papers.length > 0) addDocuments(papers)
    },
    [addImages, addDocuments],
  )

  const submit = (mode: 'queue' | 'steer' = 'queue') => {
    if (!canSend) return
    if (slash.isAction(text)) {
      runAction(text)
      return
    }
    if (turnRunning && mode === 'queue' && onQueue !== undefined && queueFull) return
    const outgoing = text
    const carried = images
    const papers = documents
    setSending(true)
    setCommandNote(null)
    // Words go straight out. A command is resolved first: an action runs
    // here and the field clears; a prompt command sends its expansion in
    // place of the words.
    const deliver = turnRunning && mode === 'queue' && onQueue !== undefined ? onQueue : onSend
    const dispatched = !slash.isCommand(outgoing)
      ? deliver(outgoing, carried, papers)
      : slash.resolve(outgoing).then((outcome) => {
          if (outcome.kind === 'done') {
            setSending(false)
            setCommandNote(outcome.note)
            if (textRef.current === outgoing) {
              setText('')
              clearDraft(conversationId)
              setMultiline(false)
            }
            return null
          }
          return deliver(outcome.kind === 'prompt' ? outcome.text : outgoing, carried, papers)
        })
    void dispatched.then(
      (receipt) => {
        if (receipt === null) return
        setSending(false)
        // Clear only what the harness actually took, and only if the
        // field still holds exactly that — words typed during the round
        // trip belong to the next message, not this receipt. Same for the
        // strip: a different array is a different message being built.
        if (
          !receipt.ok ||
          textRef.current !== outgoing ||
          imagesRef.current !== carried ||
          documentsRef.current !== papers
        ) {
          return
        }
        setText('')
        // Written out now rather than after the quiet window. A quit inside
        // that window would otherwise restore words the harness already
        // took, which reads as the app duplicating the message.
        clearDraft(conversationId)
        setMultiline(false)
        setImages([])
        setDocuments([])
        setRefusals([])
      },
      () => {
        // A send that threw instead of answering is not an acceptance
        // either. The words stay, exactly as for an explicit refusal.
        setSending(false)
      },
    )
  }

  const halt = () => onStop?.()

  return (
    <div
      ref={frame}
      data-composer-frame
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        setFocused(false)
      }}
      // A dropped file is an attachment, not a navigation. The dragover
      // refusal is what makes the drop event fire at all; without it the
      // webview would open the file over the app. A drop carrying no files
      // (dragged words, a dragged selection) is left to the field's default,
      // which inserts the text where the caret is.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer.files)
        if (files.length === 0) return
        event.preventDefault()
        ingestFiles(files)
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
        //
        // The lift is this surface's whole focus treatment, on purpose. Fields
        // elsewhere answer focus with a darkened border and nothing else; the
        // composer is a surface, not a control among other controls, and the
        // docblock above is explicit about why a drawn edge would read this
        // object as an input. Two registers, then — an edge for a field,
        // elevation for a surface — decided once here, not two components
        // disagreeing.
        focused ? 'shadow-lifted' : 'shadow-raised',
      )}
    >
      {/* The images this message carries, above the words: content of the
          message, in the message's frame. The rejections under them are the
          pick's honest remainder — a file the rules refused, named where the
          person can still do something about it. */}
      <PendingImages
        images={images}
        onRemove={removeImage}
        onKeep={(index) => {
          const image = images[index]
          if (image === undefined) return
          setKeeping({
            fileName: image.filename ?? 'image.png',
            mimeType: image.mimeType,
            data: image.data,
            sourceConversationId: conversationId,
          })
        }}
      />
      <PendingDocuments
        documents={documents}
        onRemove={removeDocument}
        onKeep={(index) => {
          const document = documents[index]
          if (document === undefined) return
          // Read now, for the dialog's copy alone; the send reads it again
          // for the upload. A document is kept as its bytes, which the
          // library takes for any file it is handed.
          void document.arrayBuffer().then((bytes) => {
            setKeeping({
              fileName: document.name,
              mimeType: documentMimeOf(document.name) ?? 'application/octet-stream',
              data: base64OfBytes(new Uint8Array(bytes)),
              sourceConversationId: conversationId,
            })
          })
        }}
      />
      <KeepDialog
        open={keeping !== null}
        candidate={keeping}
        editing={null}
        onClose={() => setKeeping(null)}
      />
      {/* The slash picker, while a name is being typed. Mounted always: it
          renders nothing until a slash offers rows, and staying mounted is
          what lets its panel play an exit instead of being torn out. It
          portals above this frame — the ref is its anchor. */}
      <SlashSuggestions
        anchor={frame}
        commands={slash.suggestions}
        selected={slash.selected}
        onPick={(command) => pickSuggestion(command.id)}
        onHover={slash.setSelected}
      />
      {commandNote !== null ? (
        <p className="mb-2 text-caption text-muted-foreground" role="status">
          {commandNote}
        </p>
      ) : null}
      {/* Improve's one sentence when it could not run - no model, harness
          down. A rare line, in the place the picker's refusals take. */}
      {improveOffer.offer?.note ? (
        <p className="mb-2 text-caption text-muted-foreground" role="status">
          {improveOffer.offer.note}
        </p>
      ) : null}
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

          The field itself spans all three columns in both arrangements and
          sits in the first row with the clusters; on one line it leaves them
          their room through its side insets (`INSET_TRANSITION`), which go
          to nothing as they drop. So the field never changes column: its
          text edge and wrapping width move as lengths, on the clock.

          The reshape is animated on the one clock, in two halves that meet.
          The track, the insets and the field's own height are CSS
          transitions, so the frame grows continuously. The controls are
          `layout="position"`: Framer glides them from where they were to
          where the grid has just slotted them, and — on the same curve —
          that glide cancels the instant re-slotting underneath it. Position
          only, never a full `layout`: size changes would be scale, and a
          scaled control stretches its mark while it moves. Reduced motion
          collapses both halves to the end state, one via MotionConfig and
          one via the global media query. */}
      <div
        style={{
          gridTemplateRows: multiline ? FOOTER_TRACK : 'auto 0px',
          transition: TRACK_TRANSITION,
        }}
        className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0"
      >
        <motion.div
          ref={leftCluster}
          layout="position"
          transition={SHAPE_MOTION}
          className={cn(
            'col-start-1 flex items-center gap-1',
            multiline ? 'row-start-2 self-end' : 'row-start-1',
          )}
        >
          {/* The image picker is this menu's one live item: the dialog it
              opens is the webview's own file input, no plugin. */}
          <AddMenu onAttach={() => picker.current?.click()} />

          {/* What Studio may do, next to the thing that will make it do it.
              The mode is the one setting whose consequence lands on the user's
              machine, and it is the one you reconsider while looking at what
              you are about to send — so it sits by the send button rather
              than three clicks deep in a menu in the window chrome. Mark only
              at rest; the name is a hover and a click away. With a live
              conversation it shows and settles that conversation's own stored
              mode; on home there is nothing stored, so it is the window's
              setting. */}
          <PermissionControl conversationId={conversationId} />
        </motion.div>

        <div
          data-composer-slot
          className="col-start-1 col-span-3 row-start-1 min-w-0"
          style={{
            paddingLeft: multiline ? 0 : inset.left,
            paddingRight: multiline ? 0 : inset.right,
            transition: INSET_TRANSITION,
          }}
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
            ) : landing !== null ? (
              // The passage arriving: the same slot, the field's own type,
              // so when the field takes over nothing on screen moves.
              <motion.div
                key="landing"
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DURATION.fast }}
              >
                <TextLanding text={landing} />
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
                  onKeyDownCapture={slashKey}
                  onMultilineChange={setMultiline}
                  onPaste={(event) => {
                    const files = Array.from(event.clipboardData.files)
                    if (files.length === 0) return
                    // The paste becomes the strip, not text in the field: a
                    // screenshot on the clipboard has no words to insert.
                    event.preventDefault()
                    ingestFiles(files)
                  }}
                  multiline={multiline}
                  inset={inset}
                  placeholder={placeholder}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <motion.div
          ref={rightCluster}
          layout="position"
          transition={SHAPE_MOTION}
          className={cn(
            'relative flex items-center gap-1',
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
              way send becomes stop while a reply streams.

              On an insecure origin the mic is not ours to ask for —
              `getUserMedia` is a secure-context capability — but the controls
              keep their places and answer as disabled. Buttons that vanish
              and return as the origin changes reshaped the whole cluster, and
              a phone reading Studio over the LAN was left with a paragraph
              where its controls had been; a greyed control with the reason as
              its label says the same thing in the space the control already
              owns. */}
          {/* Improve, once a take has landed: it acts on the field, so it
              sits with the controls that do, and it is the size they are.
              It leaves with the message - a send, an emptied field or another
              take takes it away - and the row does not move either way. */}
          <AnimatePresence initial={false}>
            {improveOffer.offer !== null && !dictating ? (
              <motion.div
                key="improve"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              >
                <ImproveButton
                  offer={improveOffer.offer}
                  onImprove={() => void improveOffer.improve()}
                  onUndo={improveOffer.undo}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <IconButton
            label={
              voiceAvailable
                ? dictation.stage === 'recording'
                  ? 'Stop and transcribe'
                  : 'Dictate'
                : VOICE_UNAVAILABLE_REASON
            }
            size="md"
            active={dictation.stage === 'recording'}
            disabled={!voiceAvailable || dictation.stage === 'requesting' || dictation.stage === 'processing'}
            onClick={() =>
              dictation.stage === 'recording' ? void dictation.stop() : void dictation.start()
            }
          >
            {dictation.stage === 'recording' ? (
              <Icons.stop size="md" />
            ) : (
              <Icons.dictate size="md" />
            )}
          </IconButton>

          {/* While the microphone owns the field there is nothing to send and
              no voice mode to offer — the strip is the message in progress,
              and the mic beside it is its only control.

              `popLayout`, because the last slot is one button that changes
              face: voice mode until there are words, send once there are.
              Without it the leaving face and the arriving one were both in
              the row for the length of the crossfade, and the cluster was a
              button wider for that long - the mic slid left on the first
              keystroke and back right when the old face had gone. Off the
              flow, the leaving face fades where it stood and the row never
              changes width. */}
          {!dictating && (
          <>
          {turnRunning && canSend ? (
            <IconButton label="Stop" size="md" onClick={halt}>
              <Icons.stop size="md" />
            </IconButton>
          ) : null}
          {steering && onQueue !== undefined ? (
            <button type="button" onClick={() => submit('steer')}
              title="Apply at the next safe step"
              className="rounded-full px-3 py-2 text-sm text-muted-foreground hover:bg-tint hover:text-foreground">
              Steer
            </button>
          ) : null}
          <AnimatePresence initial={false} mode="popLayout">
            {canSend || busy || pendingAttachments > 0 ? (
              <motion.div
                key="send"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              >
                {turnRunning && canSend && onQueue !== undefined ? (
                  <button
                    type="button"
                    aria-label="Queue message"
                    title={queueFull ? 'Queue full (3/3). Edit, delete, or steer a message first.' : 'Send after the current response finishes'}
                    disabled={queueFull}
                    onClick={() => submit()}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-85 disabled:opacity-40 [&_.studio-icon]:text-primary-foreground"
                  >
                    Queue
                    <Icons.send size="md" />
                  </button>
                ) : (
                <IconButton
                  label={steering ? 'Steer' : busy ? 'Stop' : 'Send'}
                  size="md"
                  tone="solid"
                  disabled={pendingAttachments > 0 && !busy}
                  onClick={canSend ? () => submit() : halt}
                >
                  {busy && !canSend ? (
                    <>
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
                )}
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
                    duplicate.

                    On an insecure origin the control stays where it belongs
                    and answers as disabled, its label carrying the reason —
                    the same treatment the dictate control beside it gets. */}
                <IconButton
                  label={voiceAvailable ? 'Voice mode' : VOICE_UNAVAILABLE_REASON}
                  size="md"
                  disabled={!voiceAvailable}
                  onClick={voice.enter}
                >
                  <Icons.voice size="md" />
                </IconButton>
              </motion.div>
            )}
          </AnimatePresence>
          </>
          )}
        </motion.div>
      </div>

      {/* Off-flow and invisible: only its click handler matters, opened by
          the plus menu. `accept` narrows the dialog to the four picture
          formats and the document kinds the harness reads, and `multiple`
          matches the strips' counts; the value is reset after each read so
          picking the same file twice still fires. */}
      <input
        ref={picker}
        type="file"
        accept={`image/png,image/jpeg,image/webp,image/gif,${DOCUMENT_ACCEPT}`}
        multiple
        className="hidden"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? [])
          event.target.value = ''
          ingestFiles(picked)
        }}
      />
    </div>
  )
}
