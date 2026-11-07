import { useEffect, type ReactNode } from 'react'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { SHELL } from '@/design/tokens'
import { FilePreview } from '@/features/files/FilePreview'
import { ChangesPanel } from '@/features/changes/ChangesPanel'
import { ActivityBody, ActivityList, activityRows, viewTitle } from '@/features/rail/Activity'
import { useRail, type ActivityView } from '@/stores/rail'
import { fileName, type SheetSpec } from './sheet'

/** The sheet's name for what it holds: the header, and the composer's prompt. */
export function sheetTitle(spec: SheetSpec, title: (spec: Extract<SheetSpec, { kind: 'activity' }>) => string): string {
  if (spec.kind === 'file') return fileName(spec.file.path)
  if (spec.kind === 'changes') return spec.changes.length === 1 && spec.changes[0] !== undefined ? fileName(spec.changes[0].path) : 'Changes'
  if (spec.kind === 'workspace') return 'this conversation'
  return title(spec)
}

/**
 * The sheet over the transcript: a row naming what is open, then the thing.
 *
 * The row sits in the band the window's header occupies, which the sheet
 * covers - Back and Close where a reader's eye goes for them, not a strip's
 * height further down. The body stops a clear gap above the composer, so the
 * two read as separate things.
 *
 * Back is offered only where there is somewhere to go back to - the whole
 * workspace, for something picked from it. Escape closes, as it does
 * everywhere a layer sits over the page.
 */
export function ChatSheet({ spec, onClose, onBack, onPick }: {
  spec: SheetSpec
  onClose: () => void
  onBack?: () => void
  /** Opens one thing picked from the whole workspace. */
  onPick: (view: ActivityView) => void
}) {
  const { activity, browser } = useRail()
  const title = spec.kind === 'workspace' ? 'Workspace' : sheetTitle(spec, (item) => viewTitle(item.view, activity, browser))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  let body: ReactNode
  if (spec.kind === 'file') body = <FilePreview key={spec.file.path} file={spec.file} conversationId={spec.conversationId} />
  else if (spec.kind === 'changes') body = <ChangesPanel changes={spec.changes} conversationId={spec.conversationId} />
  else if (spec.kind === 'workspace') body = <ActivityList rows={activityRows(activity, browser)} onPick={onPick} />
  else body = <ActivityBody view={spec.view} conversationId={spec.conversationId} />

  return (
    <div role="dialog" aria-label={title} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 px-2" style={{ height: SHELL.topStrip.height }}>
        {onBack ? <IconButton label="Back to the workspace" onClick={onBack}><Icons.back /></IconButton> : null}
        <h2 className="min-w-0 flex-1 truncate pl-1 text-body font-medium text-foreground">{title}</h2>
        <IconButton label="Close" onClick={onClose}><Icons.close /></IconButton>
      </div>
      <div className="studio-scroll-inset min-h-0 flex-1 overflow-y-auto rounded-[22px] bg-surface-sunken p-4">
        <div className="min-w-0">{body}</div>
      </div>
    </div>
  )
}
