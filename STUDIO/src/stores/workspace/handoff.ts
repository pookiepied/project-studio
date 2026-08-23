import type { Conversation } from '@/domain/session/types'
import type { Project } from '@/domain/projects/types'

/**
 * The state one window hands to another when it opens a conversation detached.
 *
 * Every window runs its own store -- there is no shared process behind the
 * webviews -- so a detached window left to the demo seed could not show a
 * conversation the seed has never heard of, which is any conversation made
 * after launch. The snapshot is the fix, and its shape is deliberately the
 * smallest thing that works:
 *
 * - Written at the moment of opening, from the opening window's live state
 *   (`useDetachConversation`). Not on every change, and never read back: this
 *   is a seed for a window being born, not a channel between living ones. Two
 *   open windows still do not sync -- that is a transport concern, and the
 *   day one arrives it replaces the store, not this.
 *
 * - Read once, by a detached window's `WorkspaceProvider`, as its initial
 *   state. The main window never reads a snapshot, so the studio itself always
 *   starts from the curated seed and a restart is a clean slate.
 *
 * `localStorage` because it is the one store every window of this app can see
 * -- WebView2 gives all Tauri windows the same origin, and the browser fallback
 * under `pnpm dev` has it by definition.
 */
const KEY = 'studio:workspace-handoff'

export interface WorkspaceSnapshot {
  readonly conversations: readonly Conversation[]
  readonly projects: readonly Project[]
}

/**
 * The opening window's state, or null when there is nothing usable there.
 *
 * Consumed, not just read. This snapshot is a seed for a window being born and
 * is documented as read exactly once -- but it used to be left behind
 * afterwards, so an entire conversation's messages sat in `localStorage`
 * indefinitely after the window that needed them had opened, growing with
 * every detach and never collected. Removing it on read makes the lifetime
 * match the contract: it exists between the open and the first render, and
 * nowhere else. A restart is a clean slate, which is only true if the slate is
 * actually wiped.
 *
 * Removed before parsing, so a snapshot that cannot be read still clears
 * itself rather than being retried on every launch forever.
 */
export function readHandoff(): WorkspaceSnapshot | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) return null
    window.localStorage.removeItem(KEY)

    const parsed: unknown = JSON.parse(raw)
    return isSnapshot(parsed) ? parsed : null
  } catch {
    // A snapshot that cannot be read -- absent, corrupt, or written by a
    // future shape -- falls back to the demo seed, same as no snapshot.
    return null
  }
}

export function writeHandoff(snapshot: WorkspaceSnapshot): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(snapshot))
  } catch {
    // A failed write means the new window falls back to the demo seed; it is
    // never worth failing the open over.
  }
}

function isSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<WorkspaceSnapshot>
  return (
    Array.isArray(candidate.conversations) &&
    candidate.conversations.every(isConversation) &&
    Array.isArray(candidate.projects) &&
    candidate.projects.every(isProject)
  )
}

/** Structural, not exhaustive: enough to know the renderer will not crash. */
function isConversation(value: unknown): value is Conversation {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Conversation>
  return typeof candidate.id === 'string' && Array.isArray(candidate.messages)
}

function isProject(value: unknown): value is Project {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Project>
  return typeof candidate.id === 'string' && typeof candidate.name === 'string'
}
