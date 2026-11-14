import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import {
  imageBytesOf,
  pickImageFiles,
  readImageFile,
  imageMimeOf,
  type ImageRejection,
} from '@/domain/attachments/images'
import { PendingImages } from '@/features/chat/composer/PendingImages'
import { PendingDocuments } from '@/features/chat/composer/PendingDocuments'
import { DOCUMENT_ACCEPT, documentMimeOf, pickDocumentFiles } from '@/domain/attachments/documents'
import { DUPLICATE_ATTACHMENT_NOTE, matchingDocument } from '@/domain/attachments/duplicates'
import { base64OfBytes } from '@/lib/base64'
import { KeepDialog } from '@/features/library/KeepDialog'
import type { KeepCandidate } from '@/features/library/client'
import { ComposerMenu } from '@/features/chat/composer/ComposerMenu'
import type { PermissionMode } from '@/domain/permissions/modes'
import { ComposerField, type ComposerFieldHandle } from '@/features/chat/composer/ComposerField'
import {
  clearDraft,
  clearQuote,
  readDraft,
  readQuote,
  subscribeQuotes,
  withQuotation,
  writeDraft,
} from '@/features/chat/composer/drafts'
import { QuoteStrip } from '@/features/chat/composer/QuoteStrip'
import { useTypeToFocus } from '@/features/chat/composer/useTypeToFocus'
import { useFileDrop } from '@/features/chat/composer/useFileDrop'
import { ImproveButton } from '@/features/chat/composer/ImproveButton'
import { useImproveOffer } from '@/features/chat/composer/useImproveOffer'
import { SlashSuggestions } from '@/features/chat/composer/SlashSuggestions'
import { useSlashCommands } from '@/features/chat/composer/useSlashCommands'
import { DictationControls, DictationPrompt, TextLanding, appendTake, landingDuration, useDictation } from '@/features/voice'
import { useVoiceModeContext, voiceInputAvailable, VOICE_UNAVAILABLE_REASON } from '@/features/voice'
import type { TurnImageWire } from '@/platform/harness'
import { cn } from '@/lib/cn'

/**
 * The composer.
 *
 * ---- What it holds ---------------------------------------------------------
 *
 * The compact input holds attachments at the left and voice/send at the right.
 * A long draft or carried content opens a second row without replacing the
 * field, its live dictation, or the receipt-driven submission path.
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
 * Focus lifts the surface. Wrapping is judged at the same inline width in both
 * arrangements, so moving the tools cannot make the field oscillate between them.
 *
 * ---- The quote -------------------------------------------------------------
 *
 * The Reply pill docks the passage in a strip above the field. It stays out of
 * the words until the send, where it leaves ahead of them as a Markdown
 * quotation, so the harness sees an ordinary message and nothing new.
 */
export function Composer({
  conversationId,
  turnControl,
  placeholder,
  onSend,
  busy: turnRunning = false,
  onQueue,
  queueFull = false,
  restoredMessage,
  onStop,
  onStartVoice,
  draftPermission,
  keepSentDraftForExit = false,
}: {
  conversationId: string | null
  /** Extra controls supplied by isolated hosts. The app's model lives in its header. */
  turnControl?: ReactNode
  draftPermission?: { value: PermissionMode; onChange: (value: PermissionMode) => void }
  /** Opens voice on a chat that does not exist yet; its first utterance creates it. */
  onStartVoice?: () => void
  /** The start surface crossfades its draft out after an admitted send. */
  keepSentDraftForExit?: boolean
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
  const [fieldFocused, setFieldFocused] = useState(false)
  // True from send to receipt. Without it a refused send left `busy` false
  // for the whole round trip, so a second click could start a second POST
  // while the first was still being judged.
  const [sending, setSending] = useState(false)
  const field = useRef<ComposerFieldHandle>(null)
  const quote = useSyncExternalStore(subscribeQuotes, () => readQuote(conversationId))
  // A passage arriving is the start of a reply, so the caret goes to it. One
  // that was already here when the composer mounted takes nothing.
  const lastQuote = useRef(quote)
  useEffect(() => {
    if (quote !== '' && quote !== lastQuote.current) field.current?.focus()
    lastQuote.current = quote
  }, [quote])
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
  const input = useRef<HTMLDivElement>(null)
  const leftTools = useRef<HTMLDivElement>(null)
  const rightTools = useRef<HTMLDivElement>(null)
  const [multiline, setMultiline] = useState(false)
  // Tools keep their intrinsic size while the field's margins and the space
  // below it interpolate. Measuring the resting tools, rather than the moving
  // field, also keeps the wrap threshold stable throughout that transition.
  useLayoutEffect(() => {
    const row = input.current
    const left = leftTools.current
    const right = rightTools.current
    if (!row || !left || !right) return
    const measure = () => {
      row.style.setProperty('--composer-left-tools', `${left.offsetWidth}px`)
      row.style.setProperty('--composer-right-tools', `${right.offsetWidth}px`)
      row.style.setProperty('--composer-tools-height', `${Math.max(left.offsetHeight, right.offsetHeight)}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(left)
    observer.observe(right)
    return () => observer.disconnect()
  }, [])
  const inlineWidth = useCallback(() => {
    const row = input.current
    if (!row || row.clientWidth === 0) return 0
    const gap = Number.parseFloat(getComputedStyle(row).getPropertyValue('--composer-tools-gap')) || 0
    return Math.max(1, row.clientWidth - (leftTools.current?.offsetWidth ?? 0) -
      (rightTools.current?.offsetWidth ?? 0) - gap * 2)
  }, [])
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

  // Words already on screen from a take need no second arrival when it ends.
  const takeShown = useRef(false)

  const dictation = useDictation({
    // Appended, not assigned: dictation is one input among several, and a
    // sentence typed before speaking is not made wrong by being spoken after.
    // The draft is written once, when the take ends, so Cancel has nothing to
    // undo; until then the field only shows the words.
    onTake: (spoken) => {
      const next = appendTake(textRef.current, spoken)
      setText(next)
      if (!takeShown.current) land(next)
      improveOffer.open()
    },
  })
  useEffect(() => {
    takeShown.current = dictation.transcript !== ''
  }, [dictation.transcript])

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

  // A busy conversation accepts drafts through the queue. Steering belongs
  // to the admitted message, so the composer never has two send actions.
  const busy = turnRunning || sending
  const canSend = (text.trim().length > 0 || images.length > 0 || documents.length > 0) &&
    !sending && pendingAttachments === 0 && (!turnRunning || onQueue !== undefined)
  const dictating = dictation.stage !== 'idle'
  // A take in hand, as against the mic being asked for or having refused: only
  // then do the tools give way to the take's own controls.
  const takeLive = dictation.stage === 'recording' || dictation.stage === 'paused' || dictation.stage === 'processing'
  // During a take the real field shows the words, so they wrap and grow the box
  // as typed text does. The prompt has the slot only when there are none.
  const takeWords = takeLive && dictation.transcript !== ''
  const fieldWords = takeWords ? appendTake(text, dictation.transcript) : text
  const carriedContent = images.length > 0 || documents.length > 0 || quote !== ''
  const expanded = multiline || carriedContent || dictating
  const promptShown = dictating && !(takeLive && fieldWords.trim() !== '')
  const fieldAside = promptShown || landing !== null

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
        const room = pickImageFiles([file], current.length, current.reduce((sum, image) => sum + imageBytesOf(image), 0))
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
      const pictures = files.filter((file) => file.type.startsWith('image/') || imageMimeOf(file) !== null)
      const papers = files.filter((file) => !pictures.includes(file) && documentMimeOf(file.name) !== null)
      const neither = files.filter((file) => !pictures.includes(file) && !papers.includes(file))
      setRefusals([])
      if (pictures.length > 0 || neither.length > 0) addImages([...pictures, ...neither])
      if (papers.length > 0) addDocuments(papers)
    },
    [addImages, addDocuments],
  )

  const draggingFiles = useFileDrop(frame, ingestFiles)

  const submit = () => {
    if (!canSend) return
    if (slash.isAction(text)) {
      runAction(text)
      return
    }
    if (turnRunning && onQueue !== undefined && queueFull) return
    const outgoing = text
    const carried = images
    const papers = documents
    const quoted = quote
    setSending(true)
    setCommandNote(null)
    // Words go straight out. A command is resolved first: an action runs
    // here and the field clears; a prompt command sends its expansion in
    // place of the words.
    const deliver = turnRunning && onQueue !== undefined ? onQueue : onSend
    const dispatched = !slash.isCommand(outgoing)
      ? deliver(withQuotation(quoted, outgoing), carried, papers)
      : slash.resolve(outgoing).then((outcome) => {
          if (outcome.kind === 'done') {
            setSending(false)
            setCommandNote(outcome.note)
            if (textRef.current === outgoing) {
              setText('')
              clearDraft(conversationId)
            }
            return null
          }
          return deliver(withQuotation(quoted, outcome.kind === 'prompt' ? outcome.text : outgoing), carried, papers)
        })
    void dispatched.then(
      (receipt) => {
        if (receipt === null) return
        if (!receipt.ok || !keepSentDraftForExit) setSending(false)
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
        if (!keepSentDraftForExit) setText('')
        // Written out now rather than after the quiet window. A quit inside
        // that window would otherwise restore words the harness already
        // took, which reads as the app duplicating the message.
        clearDraft(conversationId)
        if (readQuote(conversationId) === quoted) clearQuote(conversationId)
        if (keepSentDraftForExit) return
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
      data-focused={fieldFocused}
      data-expanded={expanded}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLTextAreaElement) setFieldFocused(true)
      }}
      onBlurCapture={(event) => {
        if (event.target instanceof HTMLTextAreaElement) setFieldFocused(false)
      }}
      className="studio-composer"
    >
      {draggingFiles ? <div role="status" className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-[inherit] border border-dashed border-foreground/30 bg-surface-raised/95 text-caption text-foreground">
        <Icons.paperclip />Drop files to attach
      </div> : null}
      <QuoteStrip quote={quote} onRemove={() => clearQuote(conversationId)} />
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

      <div ref={input} className="studio-composer-input">
        <div ref={leftTools} inert={dictating}
          className={cn('studio-composer-attach flex items-center gap-1 transition-opacity duration-fast',
            takeLive ? 'opacity-0' : dictating && 'opacity-50')}>
          <IconButton label="Attach files" size="md" onClick={() => picker.current?.click()}>
            <Icons.add size="md" />
          </IconButton>
          {turnControl}
          <ComposerMenu
            conversationId={conversationId}
            draftPermission={draftPermission}
            dictate={{
              unavailable: voiceAvailable ? null : VOICE_UNAVAILABLE_REASON,
              disabled: dictating,
              onSelect: () => void dictation.start(),
            }}
          />
        </div>
      {/* The field stays mounted under whatever stands in for it, hidden and
          inert, so a draft keeps its height while the microphone has the slot,
          and a passage landing reshapes the box as it arrives. */}
      <div data-composer-slot className="studio-composer-field relative flex min-h-[var(--button-md)] min-w-0 flex-col justify-center">
        <div
          inert={fieldAside || dictating}
          className={cn(
            'transition-opacity duration-fast',
            fieldAside ? 'opacity-0' : takeLive && !takeWords && 'opacity-60',
          )}
        >
          <ComposerField
            handleRef={field}
            value={fieldWords}
            followEnd={takeWords}
            inlineWidth={inlineWidth}
            onMultilineChange={setMultiline}
            onChange={setText}
            onSubmit={submit}
            onKeyDownCapture={slashKey}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length === 0) return
              // The paste becomes the strip, not text in the field: a
              // screenshot on the clipboard has no words to insert.
              event.preventDefault()
              ingestFiles(files)
            }}
            placeholder={placeholder}
          />
        </div>
        <AnimatePresence initial={false}>
          {promptShown ? (
            <motion.div
              key="dictation"
              className="absolute inset-0 overflow-hidden px-2 py-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            >
              <DictationPrompt stage={dictation.stage} denied={dictation.denied} note={dictation.note} quiet={dictation.quiet} />
            </motion.div>
          ) : landing !== null ? (
            // The passage arriving, set exactly where the field sets it, so
            // when the field takes over nothing on screen moves. A passage
            // past the field's height clips with it rather than pushing
            // the box past its ceiling.
            <motion.div
              key="landing"
              className="absolute inset-0 flex flex-col justify-start overflow-hidden px-2 py-2"
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION.fast }}
            >
              <TextLanding text={landing} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

        <div ref={rightTools} inert={dictating}
          className={cn('studio-composer-send flex shrink-0 items-center gap-1 transition-opacity duration-fast',
            takeLive ? 'opacity-0' : dictating && 'opacity-50')}>
          {/* Improve, once a take has landed. It acts on the field and it is
              brief, so it stands with the controls that do, rather than behind
              the menu. It leaves with the message. */}
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

              {/* Voice mode, not dictation: this starts a spoken conversation
                  and replaces the field. On an insecure origin it stays where
                  it belongs and answers as disabled, its label the reason. */}
              <IconButton
                label={voiceAvailable ? 'Voice mode' : VOICE_UNAVAILABLE_REASON}
                size="md"
                disabled={!voiceAvailable || (conversationId === null && onStartVoice === undefined) || busy}
                onClick={() => (conversationId === null ? onStartVoice?.() : voice.enter(conversationId))}
              >
                <Icons.waveform size="md" />
              </IconButton>
              {/* An admitted run keeps its Stop here even when the draft is empty. */}
              <IconButton
                label={canSend ? (turnRunning ? 'Queue message' : 'Send') : busy ? 'Stop' : 'Send'}
                size="md"
                tone="accent"
                disabled={(!canSend && !busy) || (pendingAttachments > 0 && !busy) || (canSend && turnRunning && queueFull)}
                onClick={canSend ? () => submit() : halt}
              >
                {busy && !canSend ? <Icons.stop size="md" /> : <Icons.sendUp size="md" />}
              </IconButton>
        </div>
      <AnimatePresence initial={false}>
        {takeLive ? (
          <motion.div
            key="take"
            className="studio-composer-transport"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
          >
            <DictationControls
              stage={dictation.stage}
              elapsedMs={dictation.elapsedMs}
              onFrame={dictation.mic.onFrame}
              onCancel={dictation.cancel}
              onPause={dictation.pause}
              onResume={dictation.resume}
              onFinish={() => void dictation.stop()}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      </div>

      {/* Off-flow and invisible: only its click handler matters, opened by
          the paperclip. `accept` narrows the dialog to the four picture
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
