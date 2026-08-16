import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { DEFAULT_MODEL_ID } from '@/domain/models/catalog'
import { DEFAULT_PERMISSION_MODE } from '@/domain/permissions/modes'
import { DEMO_CONVERSATIONS, DEMO_PROJECTS } from '@/domain/session/demo'
import type { Conversation, Message, SessionStatus, TurnSettings } from '@/domain/session/types'
import type { Project } from '@/domain/projects/types'
import { deriveTitle } from '@/stores/workspace/deriveTitle'
import { useDemoTurn } from '@/stores/workspace/useDemoTurn'
import { newId } from '@/lib/id'

/**
 * Projects, conversations, messages, and the settings a turn is sent with.
 *
 * One store, because they are one graph: a conversation belongs to a project, a
 * message belongs to a conversation, and the turn settings decide what the next
 * message does. Splitting them into a provider each is the shape that made the
 * previous shell hard to follow -- four contexts describing one surface means
 * four places to look when the surface is wrong.
 *
 * Navigation is deliberately *not* here. Where the user is looking is a
 * different question from what exists, and keeping them apart is what lets the
 * sidebar re-render on a route change without touching the conversation list.
 */

const DEFAULT_TURN_SETTINGS: TurnSettings = {
  modelId: DEFAULT_MODEL_ID,
  effort: 'medium',
  permission: DEFAULT_PERMISSION_MODE,
}

export interface NewProjectInput {
  readonly name: string
  readonly icon: Project['icon']
  readonly description: string
  readonly folders: readonly { name: string; path: string }[]
}

interface WorkspaceValue {
  readonly projects: readonly Project[]
  readonly conversations: readonly Conversation[]
  readonly status: SessionStatus
  readonly settings: TurnSettings

  setSettings: (settings: TurnSettings) => void

  createProject: (input: NewProjectInput) => Project
  removeProject: (projectId: string) => void
  setBranch: (projectId: string, branch: string) => void

  /** Creates the conversation if `conversationId` is null, and returns its id. */
  send: (conversationId: string | null, text: string, projectId: string | null) => string
  stop: () => void
  /** Drops the last reply and asks again from the same prompt. */
  retry: (conversationId: string) => void
  /** Replaces a user message and discards everything after it. */
  editMessage: (conversationId: string, messageId: string, text: string) => void
  /** Copies the conversation up to a message into a new one. */
  fork: (conversationId: string, messageId: string) => string | null

  rename: (conversationId: string, title: string) => void
  setProject: (conversationId: string, projectId: string | null) => void
  togglePin: (conversationId: string) => void
  setArchived: (conversationId: string, archived: boolean) => void
  remove: (conversationId: string) => void
  removeMany: (conversationIds: readonly string[]) => void
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<readonly Project[]>(DEMO_PROJECTS)
  const [conversations, setConversations] = useState<readonly Conversation[]>(DEMO_CONVERSATIONS)
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [settings, setSettings] = useState<TurnSettings>(DEFAULT_TURN_SETTINGS)
  const { run, cancel } = useDemoTurn()

  const patchConversation = useCallback(
    (id: string, change: (conversation: Conversation) => Conversation) => {
      setConversations((current) =>
        current.map((conversation) => (conversation.id === id ? change(conversation) : conversation)),
      )
    },
    [],
  )

  const stop = useCallback(() => {
    cancel()
    setStatus('idle')
  }, [cancel])

  // -- Projects ----------------------------------------------------------

  const createProject = useCallback((input: NewProjectInput): Project => {
    const project: Project = {
      id: newId('prj'),
      name: input.name.trim(),
      icon: input.icon,
      description: input.description.trim(),
      folders: input.folders.map((folder) => ({ id: newId('src'), ...folder })),
      branch: input.folders.length > 0 ? 'main' : null,
      branches: input.folders.length > 0 ? ['main'] : [],
      createdAt: Date.now(),
    }
    setProjects((current) => [...current, project])
    return project
  }, [])

  const removeProject = useCallback((projectId: string) => {
    // Removing a project detaches its conversations rather than deleting them.
    // The folder on disk is untouched and so is the work: this is a list the
    // user curates, not a destructive action, and the confirmation copy says so.
    setProjects((current) => current.filter((project) => project.id !== projectId))
    setConversations((current) =>
      current.map((conversation) =>
        conversation.projectId === projectId ? { ...conversation, projectId: null } : conversation,
      ),
    )
  }, [])

  const setBranch = useCallback((projectId: string, branch: string) => {
    setProjects((current) =>
      current.map((project) => (project.id === projectId ? { ...project, branch } : project)),
    )
  }, [])

  // -- Turns -------------------------------------------------------------

  const send = useCallback(
    (conversationId: string | null, text: string, projectId: string | null): string => {
      const body = text.trim()
      if (!body) return conversationId ?? ''

      const userMessage: Message = {
        id: newId('msg'),
        role: 'user',
        text: body,
        createdAt: Date.now(),
      }

      let targetId = conversationId
      if (targetId === null) {
        // Sending is what creates a conversation. There is no separate "new
        // conversation" step to forget, and no empty shell left in the list if
        // someone opens one and walks away.
        const created: Conversation = {
          id: newId('cnv'),
          title: deriveTitle(body),
          projectId,
          messages: [userMessage],
          updatedAt: Date.now(),
          pinned: false,
          archived: false,
          contextUsed: 0.02,
        }
        targetId = created.id
        setConversations((current) => [created, ...current])
      } else {
        patchConversation(targetId, (conversation) => ({
          ...conversation,
          title: conversation.title ?? deriveTitle(body),
          messages: [...conversation.messages, userMessage],
          updatedAt: Date.now(),
        }))
      }

      const id = targetId
      run({
        modelId: settings.modelId,
        patch: (change) => patchConversation(id, change),
        onThinking: () => setStatus('thinking'),
        onStreaming: () => setStatus('streaming'),
        onDone: () => setStatus('idle'),
      })

      return targetId
    },
    [patchConversation, run, settings.modelId],
  )

  const retry = useCallback(
    (conversationId: string) => {
      cancel()
      const conversation = conversations.find((item) => item.id === conversationId)
      if (!conversation) return

      // Drop trailing assistant turns so retry replaces the answer rather than
      // appending a second one under the same question.
      const kept = [...conversation.messages]
      while (kept.length > 0 && kept[kept.length - 1]?.role === 'assistant') kept.pop()
      if (kept.length === 0) return

      patchConversation(conversationId, (current) => ({ ...current, messages: kept }))
      run({
        modelId: settings.modelId,
        patch: (change) => patchConversation(conversationId, change),
        onThinking: () => setStatus('thinking'),
        onStreaming: () => setStatus('streaming'),
        onDone: () => setStatus('idle'),
      })
    },
    [cancel, conversations, patchConversation, run, settings.modelId],
  )

  const editMessage = useCallback(
    (conversationId: string, messageId: string, text: string) => {
      const body = text.trim()
      if (!body) return
      cancel()

      const conversation = conversations.find((item) => item.id === conversationId)
      if (!conversation) return
      const index = conversation.messages.findIndex((message) => message.id === messageId)
      if (index < 0) return

      // Everything after an edited message described a different question, so
      // it is discarded rather than left dangling under a prompt that no longer
      // produced it.
      const kept = conversation.messages
        .slice(0, index + 1)
        .map((message) => (message.id === messageId ? { ...message, text: body } : message))

      patchConversation(conversationId, (current) => ({
        ...current,
        messages: kept,
        updatedAt: Date.now(),
      }))

      run({
        modelId: settings.modelId,
        patch: (change) => patchConversation(conversationId, change),
        onThinking: () => setStatus('thinking'),
        onStreaming: () => setStatus('streaming'),
        onDone: () => setStatus('idle'),
      })
    },
    [cancel, conversations, patchConversation, run, settings.modelId],
  )

  const fork = useCallback(
    (conversationId: string, messageId: string): string | null => {
      const conversation = conversations.find((item) => item.id === conversationId)
      if (!conversation) return null
      const index = conversation.messages.findIndex((message) => message.id === messageId)
      if (index < 0) return null

      const copy: Conversation = {
        ...conversation,
        id: newId('cnv'),
        title: conversation.title ? `${conversation.title} (fork)` : null,
        messages: conversation.messages.slice(0, index + 1).map((message) => ({
          ...message,
          id: newId('msg'),
        })),
        updatedAt: Date.now(),
        pinned: false,
      }
      setConversations((current) => [copy, ...current])
      return copy.id
    },
    [conversations],
  )

  // -- Conversation records ---------------------------------------------

  const rename = useCallback(
    (conversationId: string, title: string) => {
      const trimmed = title.trim()
      // An empty rename is a cancelled rename, not a request for a blank title.
      if (!trimmed) return
      patchConversation(conversationId, (conversation) => ({ ...conversation, title: trimmed }))
    },
    [patchConversation],
  )

  const setProject = useCallback(
    (conversationId: string, projectId: string | null) => {
      patchConversation(conversationId, (conversation) => ({ ...conversation, projectId }))
    },
    [patchConversation],
  )

  const togglePin = useCallback(
    (conversationId: string) => {
      patchConversation(conversationId, (conversation) => ({
        ...conversation,
        pinned: !conversation.pinned,
      }))
    },
    [patchConversation],
  )

  const setArchived = useCallback(
    (conversationId: string, archived: boolean) => {
      patchConversation(conversationId, (conversation) => ({ ...conversation, archived }))
    },
    [patchConversation],
  )

  const remove = useCallback((conversationId: string) => {
    setConversations((current) => current.filter((item) => item.id !== conversationId))
  }, [])

  const removeMany = useCallback((conversationIds: readonly string[]) => {
    const doomed = new Set(conversationIds)
    setConversations((current) => current.filter((item) => !doomed.has(item.id)))
  }, [])

  const value = useMemo<WorkspaceValue>(
    () => ({
      projects,
      conversations,
      status,
      settings,
      setSettings,
      createProject,
      removeProject,
      setBranch,
      send,
      stop,
      retry,
      editMessage,
      fork,
      rename,
      setProject,
      togglePin,
      setArchived,
      remove,
      removeMany,
    }),
    [
      projects,
      conversations,
      status,
      settings,
      createProject,
      removeProject,
      setBranch,
      send,
      stop,
      retry,
      editMessage,
      fork,
      rename,
      setProject,
      togglePin,
      setArchived,
      remove,
      removeMany,
    ],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceValue {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return context
}
