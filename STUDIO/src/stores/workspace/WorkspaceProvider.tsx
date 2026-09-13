import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_PERMISSION_MODE } from '@/domain/permissions/modes'
import type { TurnSettings } from '@/domain/conversation/types'
import { bindClient } from '@/stores/workspace/bound-client'
import { LiveWorkProvider } from '@/stores/workspace/LiveWorkProvider'
import { useConversationWrites } from '@/stores/workspace/useConversationWrites'
import { useHarnessSync } from '@/stores/workspace/useHarnessSync'
import { useProjectWrites } from '@/stores/workspace/useProjectWrites'
import type { WorkspaceValue } from '@/stores/workspace/types'

/**
 * Projects, conversations, and the settings a turn is sent with.
 *
 * The store is assembled from four pieces, each its own file:
 *
 * - `useHarnessSync` reads the index and the catalog from the harness and
 *   keeps them true across restarts. It owns the client.
 * - `useConversationWrites` and `useProjectWrites` are the optimistic writes,
 *   reaching the harness through the sync's client.
 * - `bindClient` is the surfaces handed out as-is - approvals, questions,
 *   plans, jobs - bound to the client the sync holds right now.
 *
 * What is happening *now* - the working set and the context reports - is a
 * second provider, `LiveWorkProvider`, nested inside this one. It changes
 * with the stream; this one changes when a person does something. Readers
 * pick the one they need, and a streamed delta never re-renders the sidebar.
 */

/**
 * The resting turn settings. Null modelId is the harness's own default - the
 * stable alias - which is why there is no model id here to invent, and null
 * is the reasoning state of somebody who has not chosen a level: the window
 * does not know the model's levels here, so it keeps the choice absent and
 * the harness rests the turn on medium rather than the window writing a
 * level the user did not pick. A second notion of "the default model" living
 * in the webview is the same duplication Task 37 removed from titles.
 */
const DEFAULT_TURN_SETTINGS: TurnSettings = {
  modelId: null,
  reasoningLevel: null,
  permission: DEFAULT_PERMISSION_MODE,
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const sync = useHarnessSync()
  const [settings, setSettings] = useState<TurnSettings>(DEFAULT_TURN_SETTINGS)
  const conversationWrites = useConversationWrites(sync, setSettings)
  const projectWrites = useProjectWrites(sync)
  const bound = useMemo(() => bindClient(sync.clientRef), [sync.clientRef])

  const { remoteProjects, localConversations, remoteConversations, storePhase, catalog } = sync
  const conversations = useMemo(
    () => [...localConversations, ...remoteConversations],
    [localConversations, remoteConversations],
  )

  const value = useMemo<WorkspaceValue>(
    () => ({
      ...bound,
      ...conversationWrites,
      ...projectWrites,
      projects: remoteProjects,
      conversations,
      storePhase,
      catalog,
      settings,
      setSettings,
      ensureStore: sync.ensureStore,
    }),
    [
      bound,
      conversationWrites,
      projectWrites,
      remoteProjects,
      conversations,
      storePhase,
      catalog,
      settings,
      sync.ensureStore,
    ],
  )

  return (
    <WorkspaceContext.Provider value={value}>
      <LiveWorkProvider onSettled={sync.settledTitle}>{children}</LiveWorkProvider>
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): WorkspaceValue {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return context
}
