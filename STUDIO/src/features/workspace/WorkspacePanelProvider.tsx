import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { LocatedFile } from '@/features/files/useLocatedFile'
import { newUuid } from '@/lib/id'

export type WorkspaceTab =
  | { readonly key: string; readonly kind: 'file'; readonly file: LocatedFile }
  | { readonly key: 'browser'; readonly kind: 'browser' }
  | { readonly key: string; readonly kind: 'new' }

interface WorkspaceSession {
  readonly tabs: readonly WorkspaceTab[]
  readonly selected: string | null
  readonly browserDismissed?: boolean
}

interface WorkspacePanelValue extends WorkspaceSession {
  readonly conversationId: string | null
  readonly open: boolean
  readonly active: WorkspaceTab | null
  toggle: () => void
  close: () => void
  addTab: () => void
  openFile: (file: LocatedFile, replace?: string) => void
  openBrowser: (replace?: string) => void
  revealAgentBrowser: () => void
  select: (key: string) => void
  moveTab: (key: string, target: string) => void
  closeTab: (key: string) => void
}

const EMPTY: WorkspaceSession = { tabs: [], selected: null }
type Visibility = 'initial' | 'open' | 'hidden'
const WorkspacePanelContext = createContext<WorkspacePanelValue | null>(null)

/** Window visibility is shared; documents stay in their owning conversation.
 * Everything is session memory, so this experiment adds no stored migration. */
export function WorkspacePanelProvider({ conversationId, children }: { conversationId: string | null; children: ReactNode }) {
  const [{ visibility, sessions }, setPanel] = useState<{
    visibility: Visibility; sessions: ReadonlyMap<string, WorkspaceSession>
  }>({ visibility: 'initial', sessions: new Map() })
  const open = visibility === 'open'
  const session = conversationId === null ? EMPTY : sessions.get(conversationId) ?? EMPTY
  const update = useCallback((change: (current: WorkspaceSession) => WorkspaceSession, reveal = false) => {
    if (conversationId === null) return
    setPanel(current => ({
      visibility: reveal ? 'open' : current.visibility,
      sessions: new Map(current.sessions).set(conversationId, change(current.sessions.get(conversationId) ?? EMPTY)),
    }))
  }, [conversationId])
  const openTab = useCallback((tab: WorkspaceTab, replace?: string) => {
    if (conversationId === null) return
    update(current => {
      const exists = current.tabs.some(item => item.key === tab.key)
      const placeholder = current.tabs.find(item => item.kind === 'new' && item.key === replace)
      const tabs = exists
        ? current.tabs.filter(item => item !== placeholder).map(item => item.key === tab.key ? tab : item)
        : placeholder === undefined
          ? [...current.tabs, tab]
          : current.tabs.map(item => item === placeholder ? tab : item)
      return { ...current, tabs, selected: tab.key }
    }, true)
  }, [conversationId, update])
  const addTab = useCallback(() => openTab({ key: newUuid(), kind: 'new' }), [openTab])
  const openFile = useCallback((file: LocatedFile, replace?: string) => openTab({ key: `file:${file.path}`, kind: 'file', file }, replace), [openTab])
  const openBrowser = useCallback((replace?: string) => openTab({ key: 'browser', kind: 'browser' }, replace), [openTab])
  const revealAgentBrowser = useCallback(() => {
    if (conversationId === null) return
    setPanel(current => {
      const session = current.sessions.get(conversationId) ?? EMPTY
      if (session.browserDismissed || session.tabs.some(tab => tab.kind === 'browser')) return current
      return {
        visibility: current.visibility === 'hidden' ? 'hidden' : 'open',
        sessions: new Map(current.sessions).set(conversationId, {
          ...session,
          tabs: [...session.tabs, { key: 'browser', kind: 'browser' }],
          selected: current.visibility === 'hidden' ? session.selected ?? 'browser' : 'browser',
        }),
      }
    })
  }, [conversationId])
  const select = useCallback((key: string) => update(current => current.tabs.some(tab => tab.key === key)
    ? { ...current, selected: key } : current), [update])
  const moveTab = useCallback((key: string, target: string) => update(current => {
    const from = current.tabs.findIndex(tab => tab.key === key)
    const to = current.tabs.findIndex(tab => tab.key === target)
    const tab = current.tabs[from]
    if (!tab || to < 0 || to === from) return current
    const tabs = current.tabs.filter(item => item !== tab)
    tabs.splice(to, 0, tab)
    return { ...current, tabs }
  }), [update])
  const closeTab = useCallback((key: string) => update(current => {
    const index = current.tabs.findIndex(tab => tab.key === key)
    const tabs = current.tabs.filter(tab => tab.key !== key)
    return { ...current, tabs,
      browserDismissed: key === 'browser' || current.browserDismissed,
      selected: current.selected !== key ? current.selected : tabs[Math.max(0, index - 1)]?.key ?? null }
  }), [update])
  const toggle = useCallback(() => setPanel(current => ({ ...current, visibility: current.visibility === 'open' ? 'hidden' : 'open' })), [])
  const close = useCallback(() => setPanel(current => ({ ...current, visibility: 'hidden' })), [])
  const value = useMemo<WorkspacePanelValue>(() => ({
    ...session, conversationId, open, active: session.tabs.find(tab => tab.key === session.selected) ?? null,
    toggle, close, addTab, openFile, openBrowser, revealAgentBrowser, select, moveTab, closeTab,
  }), [session, conversationId, open, toggle, close, addTab, openFile, openBrowser, revealAgentBrowser, select, moveTab, closeTab])
  return <WorkspacePanelContext.Provider value={value}>{children}</WorkspacePanelContext.Provider>
}

/** Existing detached and isolated renderers keep their sheet fallback. */
export function useWorkspacePanel(): WorkspacePanelValue | null {
  return useContext(WorkspacePanelContext)
}
