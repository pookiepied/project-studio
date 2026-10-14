import { useCallback, useState } from 'react'

import { rememberFirstAdmission } from '@/features/chat/connection/first-attach'
import { uploadDocuments } from '@/features/chat/connection/documents'
import { defaultContactFor, type ContactHarness } from '@/platform/harness/contact'
import { newId } from '@/lib/id'
import type { SeamFailure, TurnImageWire, TurnSettingsWire } from '@/platform/harness'

/**
 * The first turn of a conversation, sent from a page that has no conversation.
 *
 * ---- Why this exists at all -------------------------------------------------
 *
 * Home and a project page are where every conversation begins, and until now
 * both of them sent through the workspace store's local demo turn: the words
 * never left the window, a demo reply typed itself somewhere nothing rendered
 * it, and the id that got created was one the harness had never heard of — so
 * the conversation view then attached to nothing and sat empty forever. The
 * second message worked, which is the only reason the app appeared to. A live
 * first turn is not scaffolding removal; it is the missing half of the send
 * path.
 *
 * ---- Why the submission happens HERE, before any navigation ----------------
 *
 * The alternative was to navigate first and submit on mount. It costs more in
 * every direction. The words would have to survive the transition in some
 * holder, a mount-time submit has to be proof against StrictMode's double
 * invoke and against any later remount, and — the part that decided it — a
 * refused send would have no field left to keep the words in, because the
 * field it was typed into is gone by the time the harness answers. Submitting
 * from the page the words were typed on keeps Task 32's rule intact without
 * inventing anything: the composer holds the text until a receipt says the
 * harness took it, and a refusal leaves it exactly where it was, on the page
 * the person is still looking at. Nothing is created for a send that failed —
 * no conversation in the sidebar, no id, no navigation.
 *
 * What it costs instead is a client for an id that exists nowhere yet, and
 * carrying the receipt across the navigation (`first-attach.ts`). Both are
 * cheap: ids are caller-chosen (ADR 0045), and the receipt is a fact we were
 * handed and would otherwise throw away.
 */

/** Where a first turn got to. The id exists only when the harness took it. */
export type FirstTurnOutcome =
  | { readonly ok: true; readonly conversationId: string }
  | { readonly ok: false; readonly error: SeamFailure }

/**
 * A harness that is still coming up cannot be sent to, and saying so is the
 * same sentence a missing one gets: both mean the message was not sent and
 * the words are still yours. Queueing the send until it is up is a product
 * decision nobody has made, and inventing it here would make the field lie
 * about where the message went.
 */
const NOT_RUNNING: SeamFailure = {
  kind: 'no-harness',
  message: 'The harness is not running, so the conversation cannot be started.',
}

/**
 * Mints a conversation id, submits its first turn, and keeps the receipt for
 * the view that is about to mount. Pure of React on purpose: everything worth
 * testing about a first send is here, and the hook below only holds what the
 * refusal notice renders.
 *
 * The turn's settings travel in the submission, so the harness's admission
 * path settles them into the index BEFORE the run's initializer reads them -
 * the first turn's own answer names the model that was picked.
 */
export async function startConversation(request: {
  readonly text: string
  readonly settings: TurnSettingsWire
  /** Images read and encoded beside the words; omitted for a text-only turn. */
  readonly images?: readonly TurnImageWire[]
  /** Documents, uploaded ahead of the words and taken back if they do not go. */
  readonly documents?: readonly File[]
  /** Defaults to asking the supervisor, exactly as a conversation view does. */
  readonly contactFor?: (conversationId: string) => ContactHarness
  /**
   * The conversation to admit the turn under. Defaults to a fresh id, which
   * is what a first send from Home or a project page wants. A fork passes
   * the id the harness already duplicated everything under, so the seed is
   * admitted to the fork rather than minting a second conversation - the
   * defect the old fork path had, where the seed's id and the sidebar row's
   * id were two different mints.
   */
  readonly conversationId?: string
}): Promise<FirstTurnOutcome> {
  const conversationId = request.conversationId ?? newId('cnv')
  const contact = (request.contactFor ?? defaultContactFor)(conversationId)
  const found = await contact()
  if (found.kind !== 'ready') return { ok: false, error: NOT_RUNNING }

  const uploaded = await uploadDocuments(conversationId, request.documents ?? [])
  if (!uploaded.ok) return { ok: false, error: uploaded.error }
  const sent = await found.client.submitTurn(request.text, request.settings, request.images)
  if (!sent.ok) {
    await uploaded.takeBack()
    return { ok: false, error: sent.error }
  }

  rememberFirstAdmission(conversationId, {
    offset: sent.value.offset,
    submissionId: sent.value.submissionId,
    text: request.text,
  })
  return { ok: true, conversationId }
}

export interface FirstTurnView {
  /** The last first send the harness would not take; null once one gets through. */
  readonly refused: SeamFailure | null
  /** Puts the refusal away without sending anything. */
  dismissRefusal: () => void
  /**
   * Sends, and on success hands the new conversation to `onStarted` — which
   * is where the record gets created and the view opens. Answers the receipt
   * shape the composer holds its words against.
   */
  /**
   * Sends, and on success hands the new conversation to `onStarted` — which
   * is where the record gets created and the view opens. Answers the receipt
   * shape the composer holds its words against. Images ride beside the words;
   * on a refusal both stay exactly where they were.
   */
  start: (
    text: string,
    images?: readonly TurnImageWire[],
    documents?: readonly File[],
  ) => Promise<{ readonly ok: boolean }>
}

export function useFirstTurn(options: {
  readonly onStarted: (conversationId: string, text: string) => void
  readonly contactFor?: (conversationId: string) => ContactHarness
  /**
   * The settings the first turn is sent with, read at send time - the picker's
   * current choice, not a captured one.
   */
  readonly settings: () => TurnSettingsWire
}): FirstTurnView {
  const [refused, setRefused] = useState<SeamFailure | null>(null)
  const { onStarted, contactFor, settings } = options

  const start = useCallback(
    async (text: string, images?: readonly TurnImageWire[], documents?: readonly File[]) => {
      const outcome = await startConversation({
        text,
        settings: settings(),
        ...(images === undefined ? {} : { images }),
        ...(documents === undefined ? {} : { documents }),
        ...(contactFor === undefined ? {} : { contactFor }),
      })
      if (!outcome.ok) {
        setRefused(outcome.error)
        return { ok: false }
      }
      setRefused(null)
      onStarted(outcome.conversationId, text)
      return { ok: true }
    },
    [contactFor, onStarted, settings],
  )

  const dismissRefusal = useCallback(() => setRefused(null), [])

  return { refused, dismissRefusal, start }
}
