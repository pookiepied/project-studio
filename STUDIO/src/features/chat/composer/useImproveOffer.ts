import { useCallback, useEffect, useState } from 'react'
import { improveDictation, type ImproveOutcome } from '@/features/voice/improve'

/**
 * The offer to tidy the message after it was dictated.
 *
 * A take landing opens the offer; from then until the field is sent or
 * emptied, or another take begins, the composer shows one pill: Improve.
 * It works on the whole field - what was typed around the dictation and
 * what the dictation put there - because a person who spoke a paragraph
 * into a half-typed message is asking for the message to read well, not
 * for one sentence in it to.
 *
 * Improve replaces the field with the model's version and keeps what it
 * replaced, so one gesture puts it back. Undo is offered only while the
 * field still holds exactly the improved text; a keystroke after it makes
 * the field the person's again, and the offer returns to Improve, ready to
 * run on the new text. An improved passage the person then edits is not
 * "undone" by removing their edits with it.
 *
 * The field's text is watched, not owned: the composer keeps the text and
 * passes a setter, and this hook only says when the pill is there, what it
 * says, and what it does.
 */

export type ImproveOfferState = 'ready' | 'working' | 'improved'

export interface ImproveOffer {
  readonly state: ImproveOfferState
  /** A sentence about why the last improve did not happen, until the next try. */
  readonly note: string | null
}

interface Anchor {
  state: ImproveOfferState
  /** The field before Improve, for Undo; null when nothing is improved. */
  original: string | null
  /** The field as Improve left it; Undo is offered while the field is still this. */
  improved: string | null
  note: string | null
}

const READY: Anchor = { state: 'ready', original: null, improved: null, note: null }

export function useImproveOffer({
  text,
  setText,
  improve = improveDictation,
  onImproved,
}: {
  text: string
  setText: (text: string) => void
  improve?: (text: string) => Promise<ImproveOutcome>
  /** The model's text has replaced the field: the composer shows it arriving. */
  onImproved?: (text: string) => void
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)

  useEffect(() => {
    if (anchor === null) return
    // Sent or cleared: the message the offer was about is gone.
    if (text.trim() === '') {
      setAnchor(null)
      return
    }
    // Edited after Improve: the field is the person's again.
    if (anchor.state === 'improved' && text !== anchor.improved) setAnchor(READY)
  }, [anchor, text])

  /** A take landed: offer to improve the message it is now part of. */
  const open = useCallback(() => setAnchor(READY), [])

  /** A take is starting: the last offer is withdrawn until this one lands. */
  const close = useCallback(() => setAnchor(null), [])

  const run = useCallback(async () => {
    if (anchor === null || anchor.state === 'working') return
    const before = text
    setAnchor({ ...READY, state: 'working' })
    const outcome = await improve(before)
    if (outcome.kind === 'note') {
      setAnchor((current) => (current === null ? null : { ...READY, note: outcome.note }))
      return
    }
    setText(outcome.text)
    setAnchor({ state: 'improved', original: before, improved: outcome.text, note: null })
    onImproved?.(outcome.text)
  }, [anchor, improve, onImproved, setText, text])

  const undo = useCallback(() => {
    if (anchor === null || anchor.state !== 'improved' || anchor.original === null) return
    setText(anchor.original)
    setAnchor(READY)
  }, [anchor, setText])

  const offer: ImproveOffer | null = anchor === null ? null : { state: anchor.state, note: anchor.note }

  return { offer, open, close, improve: run, undo }
}
