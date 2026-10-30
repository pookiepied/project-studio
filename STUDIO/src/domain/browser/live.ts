export type BrowserCommand =
  | { action: 'view'; since?: number }
  | { action: 'activity'; tabId: string; kind: 'move' | 'button' | 'wheel' | 'keyboard'; x: number; y: number }
  | { action: 'claim' | 'release' | 'detach' | 'new' | 'reset' }
  | { action: 'select' | 'close' | 'back' | 'forward' | 'reload'; tabId: string }
  | { action: 'navigate'; tabId: string; url: string }
  | { action: 'resize'; tabId: string; width: number; height: number }
  | { action: 'pointer'; tabId: string; kind: 'move' | 'down' | 'up'; x: number; y: number; button: 'left' | 'middle' | 'right'; clicks: number }
  | { action: 'wheel'; tabId: string; x: number; y: number }
  | { action: 'key'; tabId: string; kind: 'down' | 'up'; key: string }
  | { action: 'text'; tabId: string; text: string }

export interface LiveFrame {
  readonly data: string
  readonly sequence: number
  readonly tabId: string
  readonly width: number
  readonly height: number
}

export interface LiveBrowserState {
  readonly running: boolean
  readonly activeTabId: string | null
  readonly tabs: readonly { id: string; url: string; title: string }[]
  readonly control: 'human' | 'agent' | 'other'
  readonly busy: boolean
  readonly cursor: { x: number; y: number; tabId: string; kind?: 'default' | 'pointer' | 'text'; pressed?: boolean; pressSequence?: number } | null
  readonly frame: LiveFrame | null
  readonly omittedTabs?: number
  readonly frameUnavailable?: boolean
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }

export function parseLiveBrowserState(value: unknown): LiveBrowserState | null {
  if (!record(value) || typeof value.running !== 'boolean' || typeof value.busy !== 'boolean'
    || (value.activeTabId !== null && typeof value.activeTabId !== 'string')
    || !['human', 'agent', 'other'].includes(String(value.control)) || !Array.isArray(value.tabs)
    || (value.omittedTabs !== undefined && (!finite(value.omittedTabs) || value.omittedTabs < 0))
    || (value.frameUnavailable !== undefined && typeof value.frameUnavailable !== 'boolean')) return null
  const tabs: { id: string; url: string; title: string }[] = []
  for (const tab of value.tabs) {
    if (!record(tab) || typeof tab.id !== 'string' || typeof tab.url !== 'string' || typeof tab.title !== 'string') return null
    tabs.push({ id: tab.id, url: tab.url, title: tab.title })
  }
  let frame: LiveFrame | null = null
  if (value.frame !== null) {
    const item = value.frame
    if (!record(item) || typeof item.data !== 'string' || item.data.length > 700_000 || !/^[A-Za-z0-9+/=]*$/.test(item.data)
      || typeof item.tabId !== 'string' || !finite(item.sequence) || !finite(item.width) || !finite(item.height)
      || item.width <= 0 || item.height <= 0) return null
    frame = { data: item.data, tabId: item.tabId, sequence: item.sequence, width: item.width, height: item.height }
  }
  let cursor: LiveBrowserState['cursor'] = null
  if (value.cursor !== null) {
    const item = value.cursor
    if (!record(item) || !finite(item.x) || !finite(item.y) || item.x < 0 || item.x > 1 || item.y < 0 || item.y > 1 || typeof item.tabId !== 'string'
      || (item.kind !== undefined && item.kind !== 'default' && item.kind !== 'pointer' && item.kind !== 'text')
      || (item.pressed !== undefined && typeof item.pressed !== 'boolean')
      || (item.pressSequence !== undefined && (!finite(item.pressSequence) || !Number.isSafeInteger(item.pressSequence) || item.pressSequence < 0))) return null
    cursor = { x: item.x, y: item.y, tabId: item.tabId,
      ...(item.kind === 'default' || item.kind === 'pointer' || item.kind === 'text' ? { kind: item.kind } : {}),
      ...(typeof item.pressed === 'boolean' ? { pressed: item.pressed } : {}),
      ...(typeof item.pressSequence === 'number' ? { pressSequence: item.pressSequence } : {}) }
  }
  return { running: value.running, busy: value.busy, activeTabId: value.activeTabId, tabs,
    control: value.control === 'human' ? 'human' : value.control === 'other' ? 'other' : 'agent', frame, cursor,
    ...(typeof value.omittedTabs === 'number' ? { omittedTabs: value.omittedTabs } : {}),
    ...(typeof value.frameUnavailable === 'boolean' ? { frameUnavailable: value.frameUnavailable } : {}) }
}
