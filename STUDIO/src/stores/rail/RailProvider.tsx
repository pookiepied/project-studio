import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Artifact } from '@/domain/artifacts/types'
import type { BrowserFrame, BrowserStep } from '@/domain/browser/steps'
import type { ReportFamilyId } from '@/features/chat/transcript/live/reportFamily'
import type { RecordedChange } from '@/features/changes/recordedChanges'
import type { WorkspaceTask } from '@/features/rail/workspaceTasks'
import { loadWorkspaceCollapsed, saveWorkspaceCollapsed } from '@/platform/workspace-preferences'
import { StudioError } from '@/lib/errors'

interface EntryIdentity {
  readonly id: string
  readonly conversationId: string
  readonly conversationTitle: string
  readonly openedAt: number
}
export type RailEntry = EntryIdentity & (
  | { readonly kind: 'artifact'; readonly artifact: Artifact }
  | { readonly kind: 'changes'; readonly changes: readonly RecordedChange[] }
  | { readonly kind: 'plan' }
  | { readonly kind: 'jobs' }
  | { readonly kind: 'browser'; readonly family: ReportFamilyId; readonly recorded?: true;
      readonly url: string | null; readonly title: string | null; readonly frame: BrowserFrame | null; readonly steps: readonly BrowserStep[] }
)

export const planEntryId = (conversationId: string): string => `plan:${conversationId}`
export const jobsEntryId = (conversationId: string): string => `jobs:${conversationId}`
export const RAIL_MIN_WIDTH = 320
export const RAIL_MAX_WIDTH = 760
const EMPTY_ENTRIES: readonly RailEntry[] = []
const EMPTY_TASKS: readonly WorkspaceTask[] = []

interface RailValue {
  readonly conversationId: string | null
  readonly open: boolean
  readonly collapsed: boolean
  readonly entries: readonly RailEntry[]
  readonly activeId: string | null
  readonly width: number
  publishTasks: (conversationId: string, tasks: readonly WorkspaceTask[]) => void
  showResources: (conversationId: string, title: string, plan: boolean, jobs: boolean) => void
  overview: () => void
  openArtifact: (artifact: Artifact, conversationId: string, title: string) => void
  openPlan: (conversationId: string, title: string) => void
  openJobs: (conversationId: string, title: string) => void
  openChanges: (conversationId: string, resultId: string, changes: readonly RecordedChange[]) => void
  openBrowserResult: (conversationId: string, resultId: string, preview: {
    readonly url: string; readonly title: string; readonly frame: BrowserFrame | null; readonly steps: readonly BrowserStep[]
  }) => void
  showBrowser: (conversationId: string, title: string, report: {
    readonly family: ReportFamilyId; readonly url: string | null; readonly title: string | null;
    readonly frame: BrowserFrame | null; readonly steps: readonly BrowserStep[]
  }) => void
  focus: (id: string) => void
  close: (id: string) => void
  closeAll: () => void
  collapse: () => void
  expand: () => void
  setWidth: (width: number) => void
}

const RailContext = createContext<RailValue | null>(null)
const TaskHistoryContext = createContext<readonly WorkspaceTask[]>(EMPTY_TASKS)

export function useWorkspaceTaskHistory(): readonly WorkspaceTask[] { return useContext(TaskHistoryContext) }

/** Conversation data and focus have owners; visibility is the person's window preference. */
export function RailProvider({ children, conversationId: scope }: { children: ReactNode; conversationId?: string | null }) {
  const [resources, setResources] = useState<ReadonlyMap<string, readonly RailEntry[]>>(new Map())
  const [history, setHistory] = useState<ReadonlyMap<string, readonly WorkspaceTask[]>>(new Map())
  const [selections, setSelections] = useState<ReadonlyMap<string, string | null>>(new Map())
  const [lastScope, setLastScope] = useState<string | null>(null)
  const [width, setRawWidth] = useState(420)
  const [collapsed, setCollapsed] = useState(false)
  const [ready, setReady] = useState(false)
  const preferenceChanged = useRef(false)

  const setVisibility = useCallback((value: boolean) => {
    preferenceChanged.current = true
    setCollapsed(value)
    void saveWorkspaceCollapsed(value)
  }, [])
  useEffect(() => {
    let disposed = false
    void loadWorkspaceCollapsed().then((value) => {
      if (disposed) return
      if (!preferenceChanged.current) setCollapsed(value)
      setReady(true)
    })
    return () => { disposed = true }
  }, [])

  const select = useCallback((conversationId: string, id: string | null) => {
    setSelections((current) => new Map(current).set(conversationId, id))
    setLastScope(conversationId)
  }, [])
  const put = useCallback((entry: RailEntry) => {
    setResources((current) => {
      const held = current.get(entry.conversationId) ?? EMPTY_ENTRIES
      const existing = held.find((item) => item.id === entry.id)
      const next = existing ? held.map((item) => item.id === entry.id ? { ...entry, openedAt: item.openedAt } : item) : [...held, entry]
      return new Map(current).set(entry.conversationId, next)
    })
  }, [])
  const openEntry = useCallback((entry: RailEntry) => {
    put(entry)
    select(entry.conversationId, entry.id)
    setVisibility(false)
  }, [put, select, setVisibility])
  const openArtifact = useCallback<RailValue['openArtifact']>((artifact, conversationId, conversationTitle) => {
    openEntry({ kind: 'artifact', id: artifact.id, artifact, conversationId, conversationTitle, openedAt: Date.now() })
  }, [openEntry])
  const openPlan = useCallback<RailValue['openPlan']>((conversationId, conversationTitle) => {
    openEntry({ kind: 'plan', id: planEntryId(conversationId), conversationId, conversationTitle, openedAt: Date.now() })
  }, [openEntry])
  const openJobs = useCallback<RailValue['openJobs']>((conversationId, conversationTitle) => {
    openEntry({ kind: 'jobs', id: jobsEntryId(conversationId), conversationId, conversationTitle, openedAt: Date.now() })
  }, [openEntry])
  const openChanges = useCallback<RailValue['openChanges']>((conversationId, resultId, changes) => {
    openEntry({ kind: 'changes', id: `changes:${conversationId}:${resultId}`, conversationId, conversationTitle: 'File changes', openedAt: Date.now(), changes })
  }, [openEntry])
  const openBrowserResult = useCallback<RailValue['openBrowserResult']>((conversationId, resultId, preview) => {
    openEntry({ kind: 'browser', family: 'browser', recorded: true, id: `preview:${conversationId}:${resultId}:${preview.url}`,
      conversationId, conversationTitle: 'Web preview', openedAt: Date.now(), ...preview })
  }, [openEntry])
  const showBrowser = useCallback<RailValue['showBrowser']>((conversationId, conversationTitle, report) => {
    put({ kind: 'browser', id: `${report.family}:${conversationId}`, conversationId, conversationTitle, openedAt: Date.now(), ...report })
  }, [put])
  const showResources = useCallback<RailValue['showResources']>((conversationId, conversationTitle, plan, jobs) => {
    setResources((current) => {
      const held = current.get(conversationId) ?? EMPTY_ENTRIES
      const next = [...held]
      const kinds: readonly ('plan' | 'jobs')[] = ['plan', 'jobs']
      for (const kind of kinds) {
        if (!(kind === 'plan' ? plan : jobs)) continue
        const id = kind === 'plan' ? planEntryId(conversationId) : jobsEntryId(conversationId)
        if (!next.some((entry) => entry.id === id)) next.push({ kind, id, conversationId, conversationTitle, openedAt: Date.now() })
      }
      return next.length === held.length ? current : new Map(current).set(conversationId, next)
    })
  }, [])
  const publishTasks = useCallback<RailValue['publishTasks']>((conversationId, tasks) => {
    setHistory((current) => {
      const held = current.get(conversationId) ?? EMPTY_TASKS
      const previous = new Map(held.map((task) => [task.id, task]))
      const next = tasks.filter((task) => task.conversationId === conversationId).map((task) => {
        const old = previous.get(task.id)
        return old && old.status === task.status && old.title === task.title && old.failureReason === task.failureReason && old.timestamp === task.timestamp && old.messages.length === task.messages.length && old.messages.every((message, index) => message === task.messages[index]) ? old : task
      })
      return held.length === next.length && held.every((task, index) => task === next[index]) ? current : new Map(current).set(conversationId, next)
    })
  }, [])

  // Unscoped providers support isolated renderers; the application always supplies a route scope.
  const entries = useMemo(() => scope === undefined ? [...resources.values()].flat() : scope === null ? EMPTY_ENTRIES : resources.get(scope) ?? EMPTY_ENTRIES, [resources, scope])
  const tasks = scope ? history.get(scope) ?? EMPTY_TASKS : EMPTY_TASKS
  const selectedScope = scope === undefined ? lastScope : scope
  const selected = selectedScope ? selections.get(selectedScope) ?? null : null
  const activeId = entries.some((entry) => entry.id === selected) || tasks.some((task) => task.id === selected) ? selected : null
  const hasActivity = entries.length > 0 || tasks.length > 0
  const focus = useCallback((id: string) => {
    if (selectedScope) select(selectedScope, id)
  }, [selectedScope, select])
  const overview = useCallback(() => { if (selectedScope) select(selectedScope, null) }, [selectedScope, select])
  const close = useCallback((id: string) => {
    if (!selectedScope) return
    setResources((current) => new Map(current).set(selectedScope, (current.get(selectedScope) ?? EMPTY_ENTRIES).filter((entry) => entry.id !== id)))
    select(selectedScope, null)
  }, [selectedScope, select])
  const collapse = useCallback(() => setVisibility(true), [setVisibility])
  const expand = useCallback(() => setVisibility(false), [setVisibility])
  const setWidth = useCallback((value: number) => {
    if (Number.isFinite(value)) setRawWidth(Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, Math.round(value))))
  }, [])
  const value = useMemo<RailValue>(() => ({
    conversationId: scope ?? null, open: ready && hasActivity && !collapsed, collapsed: hasActivity && collapsed,
    entries, activeId, width, publishTasks, showResources, overview, openArtifact, openPlan, openJobs, openChanges,
    openBrowserResult, showBrowser, focus, close, closeAll: collapse, collapse, expand, setWidth,
  }), [scope, ready, hasActivity, collapsed, entries, activeId, width, publishTasks, showResources, overview, openArtifact,
    openPlan, openJobs, openChanges, openBrowserResult, showBrowser, focus, close, collapse, expand, setWidth])
  return <RailContext.Provider value={value}><TaskHistoryContext.Provider value={tasks}>{children}</TaskHistoryContext.Provider></RailContext.Provider>
}

export function useRail(): RailValue {
  const value = useContext(RailContext)
  if (!value) throw new StudioError('workspace_context', 'useRail must be used inside RailProvider')
  return value
}
