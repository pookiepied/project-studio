import { useContext, useMemo } from 'react'
import { useOptionalWorkspace } from '@/stores/workspace'
import { ReplyConversation } from './ReplyImage'

/**
 * The folder a conversation's relative paths are resolved against.
 *
 * The conversation's project primary folder is the stand the harness itself
 * uses when a reply's own paths are resolved (`/api/media/workspace` stands
 * in `projectFolders[0]` first), so it is the stand here too. Reading it
 * through the workspace store keeps the answer per-conversation by
 * construction - never this window's process directory, never another
 * conversation's folder. A conversation with no project stands in a
 * harness-owned directory the client was never told, so its root is honestly
 * null: relative references stay readable and copyable, and reveal explains
 * that the folder is not known rather than guessing.
 */

/** The only facts the lookup reads, so tests can pass plain literals. */
interface ConversationRow { readonly id: string; readonly projectId: string | null }
interface ProjectRow { readonly id: string; readonly folders: readonly { readonly path: string }[] }

export function conversationWorkspaceRoot(
  conversationId: string | null,
  conversations: readonly ConversationRow[],
  projects: readonly ProjectRow[],
): string | null {
  if (conversationId === null) return null
  const conversation = conversations.find((entry) => entry.id === conversationId)
  if (conversation === undefined || conversation.projectId === null) return null
  return projects.find((project) => project.id === conversation.projectId)?.folders[0]?.path ?? null
}

export function useConversationWorkspaceRoot(): string | null {
  const conversationId = useContext(ReplyConversation)
  const workspace = useOptionalWorkspace()
  return useMemo(
    () => conversationWorkspaceRoot(
      conversationId,
      workspace?.conversations ?? [],
      workspace?.projects ?? [],
    ),
    [conversationId, workspace],
  )
}
