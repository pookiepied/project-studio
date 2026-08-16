import { useCallback } from 'react'
import { openConversationWindow } from '@/platform/tauri'
import { writeHandoff } from '@/stores/workspace/handoff'
import { useWorkspace } from '@/stores/workspace/WorkspaceProvider'

/**
 * Opens a conversation in a window of its own, from this window's state.
 *
 * The snapshot is written *before* the window is created: the new window's
 * store is born from it (see `handoff`), and this window's state is by
 * definition current at the moment of opening -- so there is no staleness to
 * reason about, only ever one write per open.
 */
export function useDetachConversation(): (conversationId: string, title: string) => void {
  const { conversations, projects } = useWorkspace()

  return useCallback(
    (conversationId: string, title: string) => {
      writeHandoff({ conversations, projects })
      void openConversationWindow(conversationId, title)
    },
    [conversations, projects],
  )
}
