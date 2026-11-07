import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef } from 'react'

import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { useTypeToFocus } from '@/features/chat/composer/useTypeToFocus'
import { DictationControls, VOICE_UNAVAILABLE_REASON, appendTake, useDictation, voiceInputAvailable } from '@/features/voice'

/**
 * The foot of a question card: the composer in miniature.
 *
 * While a question waits the composer is gone, so its two jobs move here. The
 * field takes an answer in the person's own words, of any length: it grows
 * with what is written and scrolls past eight lines, and Shift Enter breaks a
 * line as it does in the composer. The microphone dictates into it. The round
 * button is the composer's own: stop while there is nothing to send, send once
 * there is, because a run that is waiting on a question is still a run.
 *
 * Stop here is the composer's stop - the run ends now and its questions are
 * withdrawn - not a request for a closing message, which is what the old
 * card's Stop sent and why it read as broken.
 */
export function AnswerField({
  value,
  onChange,
  onSend,
  sendLabel = 'Send answer',
  canSend,
  onStop = null,
  disabled = false,
  busy = false,
}: {
  readonly value: string
  readonly onChange: (next: string) => void
  /** Sends the written answer, or the choices ticked above when nothing is written. */
  readonly onSend: () => void
  readonly sendLabel?: string
  readonly canSend: boolean
  /** Ends the run; null where the surface has its own way out (voice mode). */
  readonly onStop?: (() => void) | null
  readonly disabled?: boolean
  readonly busy?: boolean
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  const dictation = useDictation({
    onTake: (spoken) => onChange(appendTake(valueRef.current, spoken)),
  })
  const takeLive =
    dictation.stage === 'recording' || dictation.stage === 'paused' || dictation.stage === 'processing'
  const wasLive = useRef(false)
  useEffect(() => {
    if (wasLive.current && !takeLive) field.current?.focus()
    wasLive.current = takeLive
  }, [takeLive])

  // Typing anywhere lands here, as it lands in the composer this stands in for.
  const focus = useCallback(() => field.current?.focus(), [])
  useTypeToFocus(!disabled, focus)

  const voiceAvailable = voiceInputAvailable()
  const stopping = !canSend && onStop !== null

  return (
    <div className="studio-prompt-field">
      <textarea
        ref={field}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
          event.preventDefault()
          if (value.trim() !== '' && canSend && !busy) onSend()
        }}
        placeholder="Write your own answer"
        aria-label="Your own answer"
        className="studio-prompt-textarea min-w-0 flex-1 resize-none self-center bg-transparent py-1.5 text-body outline-none placeholder:text-muted-foreground"
      />
      <IconButton
        label={voiceAvailable ? 'Dictate' : VOICE_UNAVAILABLE_REASON}
        size="xs"
        disabled={!voiceAvailable || disabled || takeLive}
        onClick={() => void dictation.start()}
      >
        <Icons.dictate size="md" />
      </IconButton>
      <IconButton
        label={stopping ? 'Stop the run' : sendLabel}
        size="xs"
        tone="accent"
        disabled={disabled || busy || (!canSend && onStop === null)}
        onClick={stopping ? (onStop ?? undefined) : onSend}
      >
        {stopping ? <Icons.stop size="md" /> : <Icons.sendUp size="md" />}
      </IconButton>

      <AnimatePresence initial={false}>
        {takeLive ? (
          <motion.div
            key="take"
            className="absolute inset-0 rounded-[inherit] bg-surface-raised px-1.5"
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
  )
}

/**
 * The stop on a permission card. A permission has no words to write - Deny is
 * its "no" - but with the composer gone the run still needs a way to end, so
 * the composer's own button stands at the card's lower right.
 */
export function StopButton({ onStop, disabled = false }: { readonly onStop: () => void; readonly disabled?: boolean }) {
  return (
    <IconButton label="Stop the run" size="xs" tone="accent" disabled={disabled} onClick={onStop}>
      <Icons.stop size="md" />
    </IconButton>
  )
}
