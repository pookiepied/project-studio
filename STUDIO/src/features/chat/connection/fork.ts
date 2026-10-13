import { useCallback, useState } from 'react'

import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import { newId } from '@/lib/id'
import { createHarnessClient, resolveHarnessAddress } from '@/platform/harness'
import type { Conversation } from '@/domain/conversation/types'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

/**
 * Forking a conversation.
 *
 * ---- What a fork is here ---------------------------------------------------
 *
 * A fork is a new, independent conversation duplicated from the source at
 * the moment of forking. The id is minted once, up front, and everything
 * addresses it: the harness duplicates the source's index row, transcript,
 * scoped rows (grants, extension decisions, plans, folder grants, document
 * rows, context figure) and filesystem tree (`workspace`, `scratch`,
 * `attachments`, `artifacts`) under it through
 * `POST /api/conversations/:id/fork`. The fork opens on the source's exact
 * words - the same turns, the same tool runs, the same state - and nothing
 * runs: no turn is admitted, no model is called.
 *
 * The previous path rendered the transcript to text and sent it as the
 * fork's first message: one synthetic turn, the model answering the whole
 * history at once. That is gone. The transcript travels in the journal now,
 * so the client reads nothing and sends nothing.
 *
 * ---- What forking is not ---------------------------------------------------
 *
 * Not a second conversation by accident. The old path minted two ids - one
 * inside `startConversation` for the seed turn, another for the sidebar row
 * - so right-clicking Fork created two conversations. One mint here, and
 * the row the harness returns is adopted locally under the same id.
 *
 * Not a branch of the model state. Pending questions and background tasks
 * stay with the source: a question is live state for a run, and a task's
 * stream belongs to the conversation that dispatched it. A fork refused for
 * either reason is a menu that simply closed, with the reason attached.
 */

/** What a fork got to: the new conversation, only when the harness took it. */
export type ForkOutcome =
  | { readonly ok: true; readonly conversationId: string }
  | { readonly ok: false; readonly note: string }

export function useForkConversation() {
  const [busy, setBusy] = useState(false)
  const { adoptConversation } = useWorkspace()
  const { openChat } = useNavigation()

  const fork = useCallback(
    async (input: {
      readonly source: Conversation
      readonly upToSubmissionId?: string
    }): Promise<ForkOutcome> => {
      setBusy(true)
      try {
        // The one id for this fork: the harness duplicates everything under
        // it. A second mint anywhere in this path is a second conversation.
        const conversationId = newId('cnv')
        const address = await resolveHarnessAddress()
        if (address === null) {
          return { ok: false, note: 'The harness is not running, so the conversation cannot be forked.' }
        }
        const forked = await createHarnessClient(address).forkConversation(
          input.source.id,
          conversationId,
          input.upToSubmissionId,
        )
        if (!forked.ok) {
          return { ok: false, note: forked.error.message }
        }
        // The row already exists server-side with the fork's title; this
        // adopts it locally and converges on reload. The fork's settings
        // are the source's own - the same model, reasoning and permission
        // mode the words were written under, already on the row.
        adoptConversation({
          id: conversationId,
          projectId: input.source.projectId,
          settings: {
            modelId: input.source.modelId,
            reasoningLevel: input.source.reasoningLevel,
            permission: input.source.permissionMode,
          },
          title: forked.value.title ?? input.source.title ?? 'Untitled',
        })
        openChat(conversationId)
        return { ok: true, conversationId }
      } finally {
        setBusy(false)
      }
    },
    [adoptConversation, openChat],
  )

  /** Fork everything: the harness copies the whole transcript. */
  const forkWhole = useCallback(
    async (source: Conversation): Promise<ForkOutcome> => fork({ source }),
    [fork],
  )

  /**
   * Branch from one answer: the fork is cut after the submission that
   * wrote it. A message with no submission behind it - nothing the model
   * ran for - carries no cut point, so the branch takes the whole
   * conversation instead of refusing.
   */
  const branchFrom = useCallback(
    async (source: Conversation, items: readonly TranscriptItem[], messageId: string) => {
      const message = items.find((item) => item.id === messageId)
      const upToSubmissionId =
        message !== undefined && 'submissionId' in message
          ? (message.submissionId ?? undefined)
          : undefined
      return fork({ source, upToSubmissionId })
    },
    [fork],
  )

  return { busy, branchFrom, forkWhole }
}
