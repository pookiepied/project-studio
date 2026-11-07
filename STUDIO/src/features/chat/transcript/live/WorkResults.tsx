import { useMemo, useState } from 'react'
import { Icons } from '@/components/icons'
import { ShowMoreButton, ShowMoreContent, Tooltip } from '@/components/primitives'
import { FileTypeMark } from '@/components/icons/fileTypes'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { recordedChanges, type RecordedChange } from '@/features/changes/recordedChanges'
import { useSheetHost } from '@/features/chat/sheet/sheet'
import { toolPresentation } from './toolPresentation'
import { answerText } from './callText'
import { useAttachmentFrame } from '@/features/chat/useAttachmentFrame'
import type { BrowserFrame } from '@/domain/browser/steps'
import { readComputerCall } from './computerCall'
import { browserResults } from './browserResults'
import { WebPreviewResult } from './WebPreviewResult'

export function WorkResults({ calls, conversationId }: {
  calls: readonly ToolCallView[]; conversationId: string; resultId?: string
}) {
  const changes = useMemo(() => recordedChanges(calls.filter((call) => toolPresentation(call.toolName).result === 'changes')), [calls])
  const pages = browserResults(calls.filter((call) => toolPresentation(call.toolName).result === 'browser'))
  const screens: { frame: BrowserFrame; title: string }[] = []
  for (const call of calls) {
    if (toolPresentation(call.toolName).result === 'computer' && call.output?.present && call.errorText === null) {
      const screen = readComputerCall(call.toolName, call.output.value, call.errorText)
      if (screen?.frame !== null && screen?.frame !== undefined) screens.push({ frame: screen.frame, title: screen.title ?? 'Computer screenshot' })
    }
  }
  const computer = screens[screens.length - 1] ?? null
  const background = calls.some((call) => toolPresentation(call.toolName).result === 'background' && call.output?.present &&
    /^Started \S+ in the background:/.test(answerText(call.output.value)))
  if (changes.length === 0 && pages.length === 0 && !background && computer === null) return null
  return <div className="mt-4 flex min-w-0 flex-col gap-3">
    {pages.map((page) => <WebPreviewResult key={page.url} preview={page} conversationId={conversationId} />)}
    {computer !== null ? <ScreenshotResult {...computer} conversationId={conversationId} /> : null}
    {changes.length > 0 ? <ChangedFiles changes={changes} conversationId={conversationId} /> : null}
    {background ? <BackgroundResult conversationId={conversationId} /> : null}
  </div>
}

function ScreenshotResult({ frame, title, conversationId }: { frame: BrowserFrame; title: string; conversationId: string }) {
  const url = useAttachmentFrame(conversationId, frame)
  if (url === null) return null
  return <section aria-label="Computer screenshot" className="rounded-lg bg-muted/60 p-3 text-caption text-foreground">
    <p className="mb-2 font-medium">{title}</p>
    <img src={url} alt={title} className="max-h-80 w-full rounded-md object-contain" />
  </section>
}

function ChangedFiles({ changes, conversationId }: {
  changes: readonly RecordedChange[]; conversationId: string
}) {
  const sheet = useSheetHost()
  const [all, setAll] = useState(false)
  const review = (items = changes) => sheet?.open({ kind: 'changes', changes: items, conversationId })
  return <section aria-label="Recorded file changes" className="min-w-0 rounded-lg bg-muted/60 px-3 py-3 text-caption text-foreground">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-2 font-medium"><Icons.edit />Changed {changes.length} {changes.length === 1 ? 'file' : 'files'}</span>
      <button type="button" className="rounded-md px-2 py-1 text-muted-foreground hover:bg-tint hover:text-foreground" onClick={() => review()}>View changes</button>
    </div>
    <p className="mb-2 text-muted-foreground">Recorded file tool changes</p>
    <ShowMoreContent><ul className="flex flex-col gap-1">
      {(all ? changes : changes.slice(0, 3)).map((change) => <li key={change.path}>
        <button type="button" className="flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 text-left hover:bg-tint" onClick={() => review([change])}>
          <FileTypeMark path={change.path} />
          <Tooltip label={change.path} overflowOnly className="min-w-0 flex-1"><span className="min-w-0 truncate">{change.path}</span></Tooltip>
          {change.diff !== null ? <span className="shrink-0 font-mono"><span className="text-diff-add">+{change.diff.added}</span>{' '}<span className="text-diff-del">-{change.diff.removed}</span></span>
            : <span className="shrink-0 text-muted-foreground">{change.action}</span>}
        </button>
      </li>)}
    </ul></ShowMoreContent>
    {changes.length > 3 ? <ShowMoreButton expanded={all} onToggle={() => setAll((value) => !value)}
      moreLabel={`Show ${changes.length - 3} more ${changes.length === 4 ? 'file' : 'files'}`}
      lessLabel="Show fewer files" className="mt-2" /> : null}
  </section>
}

function BackgroundResult({ conversationId }: { conversationId: string }) {
  const sheet = useSheetHost()
  return <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-3 text-caption text-foreground">
    <Icons.backgroundJobs /><span className="flex-1">Background work was started</span>
    {sheet === null ? null : <button type="button" onClick={() => sheet.open({ kind: 'activity', view: { kind: 'jobs' }, conversationId })} className="text-muted-foreground hover:text-foreground">View current status</button>}
  </div>
}
