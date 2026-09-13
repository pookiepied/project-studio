import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { ReasoningChoice } from '@/domain/models/types'
import type { PermissionMode } from '@/domain/permissions/modes'
import type { Conversation, TurnSettings } from '@/domain/conversation/types'
import {
  executionModeToWire,
  type HarnessClient,
  type HarnessFailure,
  type HarnessResult,
} from '@/platform/harness'
import { unreachable } from '@/stores/workspace/bound-client'
import { mapRecord } from '@/stores/workspace/records'
import type { HarnessSync } from '@/stores/workspace/useHarnessSync'
import type { ConversationWrites } from '@/stores/workspace/types'

/**
 * The writes that change which conversations exist and how they are held.
 *
 * Every write is optimistic in the same shape: the local row changes at once,
 * the harness is told, and on any refusal the truth is re-read instead of
 * locally reverted - "what did not happen" has more cases than one revert can
 * enumerate. Destruction is the exception: a row leaves only once the harness
 * says what actually went, because a refused delete (a turn in flight) must
 * keep the row exactly where it is.
 */
export function useConversationWrites(
  sync: HarnessSync,
  setSettings: Dispatch<SetStateAction<TurnSettings>>,
): ConversationWrites {
  const {
    clientRef,
    liveRef,
    load,
    trackTitle,
    remoteConversations,
    setRemoteConversations,
    localConversations,
    setLocalConversations,
  } = sync

  const patchAnyConversation = useCallback(
    (id: string, change: (conversation: Conversation) => Conversation) => {
      const apply = (current: readonly Conversation[]): readonly Conversation[] =>
        current.map((conversation) =>
          conversation.id === id ? change(conversation) : conversation,
        )
      setRemoteConversations(apply)
      setLocalConversations(apply)
    },
    [setLocalConversations, setRemoteConversations],
  )

  const mutateIndex = useCallback(
    async (
      id: string,
      patch: Parameters<HarnessClient['updateConversation']>[1],
      localChange?: (conversation: Conversation) => Conversation,
    ) => {
      if (localChange !== undefined) patchAnyConversation(id, localChange)
      const client = clientRef.current
      if (client === null) return
      const result = await client.updateConversation(id, patch)
      if (!result.ok && liveRef.current) void load()
    },
    [clientRef, liveRef, load, patchAnyConversation],
  )

  // The window's settings follow the choice too, so the composer's view and
  // the row agree the moment the pick lands.
  const setConversationSettings = useCallback(
    (
      conversationId: string,
      choice: { readonly modelId: string | null; readonly reasoningLevel: ReasoningChoice | null },
    ) => {
      setSettings((current) => ({ ...current, ...choice }))
      void mutateIndex(
        conversationId,
        { modelId: choice.modelId, reasoningLevel: choice.reasoningLevel },
        (conversation) => ({ ...conversation, ...choice }),
      )
    },
    [mutateIndex, setSettings],
  )

  const setConversationPermission = useCallback(
    (conversationId: string, permission: PermissionMode) => {
      setSettings((current) => ({ ...current, permission }))
      // The wire value is translated here, at the one boundary the store
      // already owns; the picker's vocabulary never leaves the domain.
      void mutateIndex(
        conversationId,
        { permissionMode: executionModeToWire(permission) },
        (conversation) => ({ ...conversation, permissionMode: permission }),
      )
    },
    [mutateIndex, setSettings],
  )

  const beginConversation = useCallback<ConversationWrites['beginConversation']>(
    (input) => {
      // This window began the conversation, so its first exchange will
      // settle before a witness here, and the harness may still rename the
      // row afterwards: tracked, so the settlement arms the one re-read
      // that catches it.
      trackTitle(input.id)
      setRemoteConversations((current) => {
        // A second record under one receipt would be two sidebar rows pointing
        // at the same stream.
        if (current.some((conversation) => conversation.id === input.id)) return current
        return [
          {
            id: input.id,
            title: input.title ?? null,
            projectId: input.projectId,
            updatedAt: Date.now(),
            pinned: false,
            archived: false,
            modelId: input.settings.modelId,
            reasoningLevel: input.settings.reasoningLevel,
            permissionMode: input.settings.permission,
          },
          ...current,
        ]
      })

      const client = clientRef.current
      if (client === null) return
      void client
        .createConversation({
          id: input.id,
          firstMessage: input.firstMessage,
          ...(input.projectId === null ? {} : { projectId: input.projectId }),
          modelId: input.settings.modelId,
          reasoningLevel: input.settings.reasoningLevel,
          permissionMode: executionModeToWire(input.settings.permission),
          createdAt: Date.now(),
        })
        .then(async (result) => {
          if (!liveRef.current) return
          if (!result.ok) {
            await load()
            return
          }
          const stored = mapRecord(result.value)
          setRemoteConversations((current) =>
            current.map((conversation) =>
              conversation.id === stored.id ? stored : conversation,
            ),
          )
        })
    },
    [clientRef, liveRef, load, setRemoteConversations, trackTitle],
  )

  const touch = useCallback(
    (conversationId: string) => {
      void mutateIndex(
        conversationId,
        { lastTurnAt: Date.now() },
        (conversation) => ({ ...conversation, updatedAt: Date.now() }),
      )
    },
    [mutateIndex],
  )

  const rename = useCallback(
    (conversationId: string, title: string) => {
      const trimmed = title.trim()
      // An empty rename is a cancelled rename, not a request for a blank title.
      if (!trimmed) return
      void mutateIndex(
        conversationId,
        { title: trimmed },
        (conversation) => ({ ...conversation, title: trimmed }),
      )
    },
    [mutateIndex],
  )

  const setProject = useCallback(
    (conversationId: string, projectId: string | null) => {
      void mutateIndex(
        conversationId,
        { projectId },
        (conversation) => ({ ...conversation, projectId }),
      )
    },
    [mutateIndex],
  )

  const togglePin = useCallback(
    (conversationId: string) => {
      const current =
        remoteConversations.find((item) => item.id === conversationId) ??
        localConversations.find((item) => item.id === conversationId)
      const pinned = !(current?.pinned ?? false)
      void mutateIndex(
        conversationId,
        { pinned },
        (conversation) => ({ ...conversation, pinned }),
      )
    },
    [localConversations, mutateIndex, remoteConversations],
  )

  const setArchived = useCallback(
    (conversationId: string, archived: boolean) => {
      void mutateIndex(
        conversationId,
        { archived },
        (conversation) => ({ ...conversation, archived }),
      )
    },
    [mutateIndex],
  )

  // Deleting removes the conversation everywhere it exists - the journal,
  // the scoped rows, the index row, and the tree - so the local copies leave
  // only once the harness says what actually went. A refusal (a turn in
  // flight) keeps the row; a partial destruction reloads, so the list shows
  // the truth rather than the request.
  const remove = useCallback(
    async (conversationId: string): Promise<HarnessFailure | null> => {
      const client = clientRef.current
      if (client === null) {
        return unreachable('The harness is not running, so the conversation was not deleted.')
          .error
      }
      const result = await client.deleteConversation(conversationId)
      if (!liveRef.current) return result.ok ? null : result.error
      if (!result.ok) {
        void load()
        return result.error
      }
      const outcome = result.value
      if (outcome.removed.includes(conversationId)) {
        const doomed = conversationId
        setRemoteConversations((current) => current.filter((item) => item.id !== doomed))
        setLocalConversations((current) => current.filter((item) => item.id !== doomed))
        return null
      }
      await load()
      const detail = outcome.details[conversationId]
      const message = detail?.error ?? 'The conversation could not be deleted.'
      return {
        kind: 'harness-error',
        status: detail?.errorCode === 'storage.conflict' ? 409 : 500,
        message,
        ...(detail?.errorCode === undefined ? {} : { code: detail.errorCode }),
      }
    },
    [clientRef, liveRef, load, setLocalConversations, setRemoteConversations],
  )

  const removeMany = useCallback(
    async (conversationIds: readonly string[]): Promise<Readonly<Record<string, string>>> => {
      const doomed = new Set(conversationIds)
      setRemoteConversations((current) => current.filter((item) => !doomed.has(item.id)))
      const client = clientRef.current
      if (client === null || doomed.size === 0) return {}
      const result = await client.purgeConversations([...doomed])
      if (!liveRef.current) return {}
      if (!result.ok) {
        await load()
        return {}
      }
      // Rows the purge refused or only half-destroyed are back after the
      // reload; the per-id sentences say which ones and why.
      if ([...doomed].some((id) => !result.value.removed.includes(id))) await load()
      return result.value.cleanupFailures
    },
    [clientRef, liveRef, load, setRemoteConversations],
  )

  const [orphanTrees, setOrphanTrees] = useState<readonly string[]>([])

  const refreshOrphanTrees = useCallback(async (): Promise<void> => {
    const client = clientRef.current
    if (client === null) return
    const result = await client.listOrphanTrees()
    if (!liveRef.current || !result.ok) return
    setOrphanTrees(result.value.orphans)
  }, [clientRef, liveRef])

  const sweepOrphanTrees = useCallback(async (): Promise<
    HarnessResult<Readonly<Record<string, string>>>
  > => {
    const client = clientRef.current
    if (client === null) {
      return unreachable('The harness is not running, so the leftover folders were not removed.')
    }
    const result = await client.sweepOrphanTrees()
    if (!result.ok) return result
    if (!liveRef.current) return { ok: true, value: {} }
    await refreshOrphanTrees()
    return { ok: true, value: result.value.failures }
  }, [clientRef, liveRef, refreshOrphanTrees])

  // One object for as long as nothing in it changed, so the provider's own
  // memo holds and a render here is not a new store for every reader.
  return useMemo(
    () => ({
      setConversationSettings,
      setConversationPermission,
      beginConversation,
      touch,
      rename,
      setProject,
      togglePin,
      setArchived,
      remove,
      removeMany,
      orphanTrees,
      refreshOrphanTrees,
      sweepOrphanTrees,
    }),
    [
      setConversationSettings,
      setConversationPermission,
      beginConversation,
      touch,
      rename,
      setProject,
      togglePin,
      setArchived,
      remove,
      removeMany,
      orphanTrees,
      refreshOrphanTrees,
      sweepOrphanTrees,
    ],
  )
}
