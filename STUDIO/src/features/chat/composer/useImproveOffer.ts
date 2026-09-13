import { useCallback, useEffect, useRef, useState } from 'react'
import { improveDictation, type ImproveOutcome } from '@/features/voice/improve'

/**
 * The offer to tidy what was just dictated.
 *
 * After a take ends, the words it put in the field are the "span": the tail
 * of the field, exactly as the transcriber gave them. While that span is
 * still there, unedited and unsent, the composer offers Improve; the moment
 * the field stops ending with it - a keystroke, a send, a second take - the
 * offer is gone, because it was about those words and no others.
 *
 * Improve replaces the span with the model's tidied version and keeps the
 * original, so one gesture puts it back. Undo swaps them again. The span
 * tracks the current words either way, which is what keeps the offer
 * anchored through both.
 *
 * The take's words are collected here segment by segment as dictation
 * delivers them, so the span is what dictation wrote and nothing the person
 * typed before or after.
 */

type ImproveOfferState = 'ready' | 'working' | 'improved'

interface ImproveOffer {
  readonly state: ImproveOfferState
  /** The words the offer is about: the field's current tail. */
  readonly span: string
  /** A sentence about why the last improve did not happen, until the next try. */
  readonly note: string | null
}

interface Anchor {
  span: string
  /** What the span was before Improve, for Undo; null when not improved. */
  original: string | null
  state: ImproveOfferState
  note: string | null
}

export function useImproveOffer({
  text,
  setText,
  improve = improveDictation,
}: {
  text: string
  setText: (update: (current: string) => string) => void
  improve?: (text: string) => Promise<ImproveOutcome>
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const take = useRef('')

  // The offer is about the field's tail. The field changing underneath it
  // - typed, sent, cleared - withdraws it; our own replacement keeps the
  // span in step with the text, so it survives that.
  useEffect(() => {
    if (anchor !== null && !text.endsWith(anchor.span)) setAnchor(null)
  }, [anchor, text])

  /** A take is starting: whatever it delivers is the next span. */
  const begin = useCallback(() => {
    take.current = ''
    setAnchor(null)
  }, [])

  /** Dictation delivered one more piece of the take. */
  const record = useCallback((spoken: string) => {
    take.current = take.current === '' ? spoken : `${take.current} ${spoken}`
  }, [])

  /** The take ended: offer to improve what it delivered, if anything. */
  const finish = useCallback(() => {
    const span = take.current
    take.current = ''
    if (span === '') return
    setAnchor({ span, original: null, state: 'ready', note: null })
  }, [])

  const replaceSpan = useCallback(
    (from: string, to: string) => {
      setText((current) =>
        current.endsWith(from) ? `${current.slice(0, current.length - from.length)}${to}` : current,
      )
    },
    [setText],
  )

  const run = useCallback(async () => {
    if (anchor === null || anchor.state !== 'ready') return
    const { span } = anchor
    setAnchor({ ...anchor, state: 'working', note: null })
    const outcome = await improve(span)
    if (outcome.kind === 'note') {
      setAnchor((current) =>
        current === null || current.span !== span ? current : { ...current, state: 'ready', note: outcome.note },
      )
      return
    }
    replaceSpan(span, outcome.text)
    setAnchor({ span: outcome.text, original: span, state: 'improved', note: null })
  }, [anchor, improve, replaceSpan])

  const undo = useCallback(() => {
    if (anchor === null || anchor.original === null) return
    replaceSpan(anchor.span, anchor.original)
    setAnchor({ span: anchor.original, original: null, state: 'ready', note: null })
  }, [anchor, replaceSpan])

  const offer: ImproveOffer | null =
    anchor === null ? null : { state: anchor.state, span: anchor.span, note: anchor.note }

  return { offer, begin, record, finish, improve: run, undo }
}
