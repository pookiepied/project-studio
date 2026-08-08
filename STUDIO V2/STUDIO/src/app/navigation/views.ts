import type { ComponentType } from 'react'
import { Apps, Chat, Settings, Workspace } from '@/components/icons'
import type { IconSize } from '@/components/icons'

export type View = 'chat' | 'workspace' | 'connectors' | 'settings'

type ViewIcon = ComponentType<{ size?: IconSize; className?: string }>

export interface ViewEntry {
  id: View
  label: string
  icon: ViewIcon
  /**
   * `false` renders the entry disabled in the dock instead of hiding it, so the
   * shape of the app stays visible before every surface exists. Flip to `true`
   * only when the view renders something real — the same convention the
   * settings section nav uses.
   */
  ready: boolean
}

/** The view registry — the dock and the shell both render from this list. */
export const VIEWS: readonly ViewEntry[] = [
  { id: 'chat', label: 'Chat', icon: Chat, ready: true },
  { id: 'workspace', label: 'Workspace', icon: Workspace, ready: true },
  { id: 'connectors', label: 'Connectors', icon: Apps, ready: false },
  { id: 'settings', label: 'Settings', icon: Settings, ready: true },
]

export function findView(id: View): ViewEntry {
  const entry = VIEWS.find((view) => view.id === id)
  if (!entry) throw new Error(`Unknown view: ${id}`)
  return entry
}
