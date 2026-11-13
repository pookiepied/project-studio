import { createContext, useContext } from 'react'
import type { LocatedFile } from '@/features/files/useLocatedFile'
import type { RecordedChange } from '@/features/changes/recordedChanges'
import type { ActivityView } from '@/stores/overview'

/**
 * What the chat page can lay over its transcript, with the composer kept.
 *
 * The sheet is where something too big for the reply is looked at: a file, a
 * set of changes, one thing from Overview. It covers the transcript and
 * stops at the composer, so what is typed while it is open is about what is
 * open. It works at any window size, which is why viewers live here and not
 * in the Overview column: the column only exists when the window is wide.
 *
 * Main-window documents open in the central Workspace. Detached windows keep
 * their file sheet fallback. A picture has its own viewer (`MediaViewer`), opened through
 * `MediaViewerHostContext`, because typing over a picture attaches it.
 */
export type SheetSpec =
  | { readonly kind: 'file'; readonly file: LocatedFile; readonly conversationId: string }
  | { readonly kind: 'changes'; readonly changes: readonly RecordedChange[]; readonly conversationId: string }
  | { readonly kind: 'activity'; readonly view: ActivityView; readonly conversationId: string }
  /** The activity overview: what is going, what each turn changed, what finished. */
  | { readonly kind: 'overview'; readonly conversationId: string }

export interface SheetHost {
  /**
   * Opens the sheet. Overview activity goes to the docked column instead
   * when the window has one, so the same row works at any size.
   */
  open: (spec: SheetSpec) => void
}

export const SheetHostContext = createContext<SheetHost | null>(null)

/** Null outside a chat page: whatever offers a sheet should not offer it there. */
export function useSheetHost(): SheetHost | null {
  return useContext(SheetHostContext)
}

export function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}
