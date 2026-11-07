import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BrowserFrame, BrowserStep } from '@/domain/browser/steps'
import type { ReportFamilyId } from '@/features/chat/transcript/live/reportFamily'
import type { AgentTask, BackgroundJob, PlanSnapshot } from '@/platform/harness'
import type { RecordedChange } from '@/features/changes/recordedChanges'
import { SHELL } from '@/design/tokens'
import { loadWorkspaceCollapsed, saveWorkspaceCollapsed } from '@/platform/workspace-preferences'
import { StudioError } from '@/lib/errors'

/**
 * The conversation's workspace: what is happening behind the reply.
 *
 * Activity, not history. It holds the plan, the agents the conversation
 * started, the commands it left running, and the browser or computer it is
 * driving - each as the harness reports it now. What the transcript already
 * says (every turn, every tool call, every agent's transcript) is not
 * repeated here, and nothing opened from a reply lands here either: a file,
 * a diff or a picture opens in the sheet over the transcript instead.
 *
 * Where it draws depends on the room. With space beside the conversation it
 * is a docked column (`docked`); without it, a pill over the composer, a
 * small list from the pill, and a sheet for the one thing being looked at.
 */

/** The live browser or computer the conversation is driving. */
export interface BrowserActivity {
  readonly conversationId: string
  readonly family: ReportFamilyId
  readonly url: string | null
  readonly title: string | null
  readonly frame: BrowserFrame | null
  readonly steps: readonly BrowserStep[]
}

/** The files one turn's tools changed, as their receipts recorded them. */
export interface TurnChanges {
  /** The turn's submission id. */
  readonly id: string
  /** When the person wrote the message the turn answered, if known. */
  readonly at: string | null
  readonly changes: readonly RecordedChange[]
}

/** What the conversation is doing, and what it has changed, as last published by its page. */
export interface Activity {
  readonly plan: PlanSnapshot | null
  readonly agents: readonly AgentTask[]
  readonly jobs: readonly BackgroundJob[]
  /** Turns that changed files, oldest first. The conversation's record of edits. */
  readonly turns: readonly TurnChanges[]
}

/** One thing in the workspace, looked at on its own. */
export type ActivityView =
  | { readonly kind: 'plan' }
  | { readonly kind: 'jobs' }
  | { readonly kind: 'agent'; readonly agentId: string }
  | { readonly kind: 'browser' }
  | { readonly kind: 'changes'; readonly turnId: string }

export const RAIL_MIN_WIDTH = 320
export const RAIL_MAX_WIDTH = 760

/**
 * The narrowest window the docked column fits: the page's floor, the column's
 * floor, and the gutter between them. Below it the workspace is the pill.
 */
export const DOCKED_MIN_WINDOW = SHELL.minPageWidth + RAIL_MIN_WIDTH + SHELL.railGutter

/** The same rows, or both empty: a fresh empty list is not news. */
function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a === b || (a.length === 0 && b.length === 0)
}

const NO_ACTIVITY: Activity = { plan: null, agents: [], jobs: [], turns: [] }

export function hasPlan(activity: Activity): boolean {
  return activity.plan !== null && activity.plan.items.length > 0
}

export function isEmptyActivity(activity: Activity, browser: BrowserActivity | null): boolean {
  return !hasPlan(activity) && activity.agents.length === 0 && activity.jobs.length === 0 && activity.turns.length === 0 && browser === null
}

export function sameView(a: ActivityView | null, b: ActivityView | null): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'agent') return b.kind === 'agent' && a.agentId === b.agentId
  if (a.kind === 'changes') return b.kind === 'changes' && a.turnId === b.turnId
  return true
}

interface RailValue {
  readonly conversationId: string | null
  /** The docked column is on screen. */
  readonly open: boolean
  /** There is activity, and the person folded the column away. */
  readonly collapsed: boolean
  /** The window has room for the column beside the conversation. */
  readonly docked: boolean
  readonly activity: Activity
  readonly browser: BrowserActivity | null
  /** What the docked column is showing; null is the list. */
  readonly view: ActivityView | null
  readonly width: number
  /**
   * Counts requests to see the whole workspace from outside the page (the
   * header's Workspace item) in a window with no column, where the page
   * answers by opening its sheet.
   */
  readonly overviewRequests: number
  publishActivity: (conversationId: string, activity: Activity) => void
  showBrowser: (conversationId: string, report: Omit<BrowserActivity, 'conversationId'>) => void
  /** Brings one thing - or, given null, the whole list - forward in the docked column, unfolding it. */
  show: (view: ActivityView | null) => void
  overview: () => void
  /** The whole workspace: the column's list when docked, else the page's sheet. */
  openOverview: () => void
  collapse: () => void
  expand: () => void
  closeAll: () => void
  setWidth: (width: number) => void
}

const RailContext = createContext<RailValue | null>(null)

function useWindowFits(width: number): boolean {
  const query = `(min-width: ${String(width)}px)`
  const [fits, setFits] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(query)
    setFits(media.matches)
    const onChange = (event: MediaQueryListEvent) => setFits(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return fits
}

/** Conversation data and focus have owners; visibility is the person's window preference. */
export function RailProvider({ children, conversationId: scope }: { children: ReactNode; conversationId?: string | null }) {
  const [activities, setActivities] = useState<ReadonlyMap<string, Activity>>(new Map())
  const [browsers, setBrowsers] = useState<ReadonlyMap<string, BrowserActivity>>(new Map())
  const [views, setViews] = useState<ReadonlyMap<string, ActivityView | null>>(new Map())
  const [lastScope, setLastScope] = useState<string | null>(null)
  const [width, setRawWidth] = useState(420)
  const [collapsed, setCollapsed] = useState(false)
  const [ready, setReady] = useState(false)
  const [overviewRequests, setOverviewRequests] = useState(0)
  const preferenceChanged = useRef(false)
  const docked = useWindowFits(DOCKED_MIN_WINDOW)

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

  const publishActivity = useCallback<RailValue['publishActivity']>((conversationId, activity) => {
    setActivities((current) => {
      const held = current.get(conversationId)
      if (held !== undefined && held.plan === activity.plan && sameList(held.agents, activity.agents) && sameList(held.jobs, activity.jobs) && sameList(held.turns, activity.turns)) return current
      return new Map(current).set(conversationId, activity)
    })
    setLastScope(conversationId)
  }, [])
  const showBrowser = useCallback<RailValue['showBrowser']>((conversationId, report) => {
    setBrowsers((current) => new Map(current).set(conversationId, { conversationId, ...report }))
    setLastScope(conversationId)
  }, [])

  // Unscoped providers support isolated renderers; the application always supplies a route scope.
  const selectedScope = scope === undefined ? lastScope : scope
  const activity = selectedScope ? activities.get(selectedScope) ?? NO_ACTIVITY : NO_ACTIVITY
  const browser = selectedScope ? browsers.get(selectedScope) ?? null : null
  const chosen = selectedScope ? views.get(selectedScope) ?? null : null
  // A view whose subject has gone (the agent's row left the registry, the
  // plan was cleared) falls back to the list rather than an empty page.
  const view = chosen === null ? null
    : chosen.kind === 'plan' ? hasPlan(activity) ? chosen : null
    : chosen.kind === 'jobs' ? activity.jobs.length > 0 ? chosen : null
    : chosen.kind === 'browser' ? browser !== null ? chosen : null
    : chosen.kind === 'changes' ? activity.turns.some((turn) => turn.id === chosen.turnId) ? chosen : null
    : activity.agents.some((agent) => agent.id === chosen.agentId) ? chosen : null
  const hasActivity = !isEmptyActivity(activity, browser)

  const select = useCallback((value: ActivityView | null) => {
    if (selectedScope) setViews((current) => new Map(current).set(selectedScope, value))
  }, [selectedScope])
  const show = useCallback((value: ActivityView | null) => { select(value); setVisibility(false) }, [select, setVisibility])
  const overview = useCallback(() => select(null), [select])
  const openOverview = useCallback(() => {
    if (docked) { select(null); setVisibility(false) }
    else setOverviewRequests((count) => count + 1)
  }, [docked, select, setVisibility])
  const collapse = useCallback(() => setVisibility(true), [setVisibility])
  const expand = useCallback(() => setVisibility(false), [setVisibility])
  const setWidth = useCallback((value: number) => {
    if (Number.isFinite(value)) setRawWidth(Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, Math.round(value))))
  }, [])

  const value = useMemo<RailValue>(() => ({
    conversationId: scope ?? null,
    open: ready && docked && hasActivity && !collapsed,
    collapsed: hasActivity && collapsed,
    docked, activity, browser, view, width, overviewRequests,
    publishActivity, showBrowser, show, overview, openOverview, collapse, expand, closeAll: collapse, setWidth,
  }), [scope, ready, docked, hasActivity, collapsed, activity, browser, view, width, overviewRequests, publishActivity, showBrowser, show, overview, openOverview, collapse, expand, setWidth])
  return <RailContext.Provider value={value}>{children}</RailContext.Provider>
}

export function useRail(): RailValue {
  const value = useContext(RailContext)
  if (!value) throw new StudioError('workspace_context', 'useRail must be used inside RailProvider')
  return value
}
