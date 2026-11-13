import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { LocatedFile } from '@/features/files/useLocatedFile'

export type WorkspaceTab =
  | { readonly key: string; readonly kind: 'file'; readonly file: LocatedFile }
  | { readonly key: 'browser'; readonly kind: 'browser' }

interface WorkspaceSession {
  readonly tabs: readonly WorkspaceTab[]
  readonly selected: string | null
}

interface WorkspacePanelValue extends WorkspaceSession {
  readonly conversationId: string | null
  readonly open: boolean
  readonly active: WorkspaceTab | null
  toggle: () => void
  close: () => void
  openFile: (file: LocatedFile) => void
  openBrowser: () => void
  select: (key: string) => void
  closeTab: (key: string) => void
}

const EMPTY: WorkspaceSession = { tabs: [], selected: null }
const WorkspacePanelContext = createContext<WorkspacePanelValue | null>(null)

/** Window visibility is shared; documents stay in their owning conversation.
 * Everything is session memory, so this experiment adds no stored migration. */
export function WorkspacePanelProvider({ conversationId, children }: { conversationId: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<ReadonlyMap<string, WorkspaceSession>>(new Map())
  const session = conversationId === null ? EMPTY : sessions.get(conversationId) ?? EMPTY
  const update = useCallback((change: (current: WorkspaceSession) => WorkspaceSession) => {
    if (conversationId === null) return
    setSessions(current => new Map(current).set(conversationId, change(current.get(conversationId) ?? EMPTY)))
  }, [conversationId])
  const openTab = useCallback((tab: WorkspaceTab) => {
    if (conversationId === null) return
    update(current => ({
      tabs: current.tabs.some(item => item.key === tab.key)
        ? current.tabs.map(item => item.key === tab.key ? tab : item)
        : [...current.tabs, tab],
      selected: tab.key,
    }))
    setOpen(true)
  }, [conversationId, update])
  const openFile = useCallback((file: LocatedFile) => openTab({ key: `file:${file.path}`, kind: 'file', file }), [openTab])
  const openBrowser = useCallback(() => openTab({ key: 'browser', kind: 'browser' }), [openTab])
  const select = useCallback((key: string) => update(current => current.tabs.some(tab => tab.key === key)
    ? { ...current, selected: key } : current), [update])
  const closeTab = useCallback((key: string) => update(current => {
    const index = current.tabs.findIndex(tab => tab.key === key)
    const tabs = current.tabs.filter(tab => tab.key !== key)
    return { tabs, selected: current.selected !== key ? current.selected : tabs[Math.max(0, index - 1)]?.key ?? null }
  }), [update])
  const toggle = useCallback(() => setOpen(value => !value), [])
  const close = useCallback(() => setOpen(false), [])
  const value = useMemo<WorkspacePanelValue>(() => ({
    ...session, conversationId, open, active: session.tabs.find(tab => tab.key === session.selected) ?? null,
    toggle, close, openFile, openBrowser, select, closeTab,
  }), [session, conversationId, open, toggle, close, openFile, openBrowser, select, closeTab])
  return <WorkspacePanelContext.Provider value={value}>{children}</WorkspacePanelContext.Provider>
}

/** Existing detached and isolated renderers keep their sheet fallback. */
export function useWorkspacePanel(): WorkspacePanelValue | null {
  return useContext(WorkspacePanelContext)
}
