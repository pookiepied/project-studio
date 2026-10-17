import { FileTypeMark, splitFilePath } from '@/components/icons/fileTypes'
import { isRecord } from '@/lib/guards'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { ToolResultPanel } from './ToolResultPanel'

interface FileOperationView {
  readonly kind: 'move' | 'delete'
  readonly path: string
  readonly destination: string | null
  readonly recursive: boolean
  readonly overwrite: boolean
}

/** Only native calls with usable paths earn a file-operation presentation. */
export function fileOperationOf(call: ToolCallView): FileOperationView | null {
  if (call.toolName !== 'move' && call.toolName !== 'delete') return null
  const input: unknown = call.input?.present ? call.input.value : null
  if (!isRecord(input)) return null
  const path = call.toolName === 'move' ? input['from'] : input['path']
  const destination = call.toolName === 'move' ? input['to'] : null
  if (typeof path !== 'string' || path.trim() === '') return null
  if (call.toolName === 'move' && (typeof destination !== 'string' || destination.trim() === '')) return null
  // Unknown result formats keep the generic inspector rather than losing data.
  if (call.output?.present && typeof call.output.value !== 'string') return null
  return {
    kind: call.toolName,
    path,
    destination: typeof destination === 'string' ? destination : null,
    recursive: input['recursive'] === true,
    overwrite: input['overwrite'] === true,
  }
}

export function FileOperation({ call, view, live }: {
  call: ToolCallView
  view: FileOperationView
  live: boolean
}) {
  const failed = call.errorText !== null
  const answered = call.output?.present === true
  const output = answered && typeof call.output?.value === 'string' ? call.output.value : null
  const headline = view.kind === 'move'
    ? `Moved ${view.path} to ${view.destination}.`
    : `Deleted ${view.path}.`
  const confirmed = !failed && output?.startsWith(headline) === true
  // Keep recovery locations and created-directory notes verbatim. Only the
  // redundant headline is removed, using the exact paths rather than a regex.
  const note = confirmed && output !== null ? output.slice(headline.length).trim() : output
  return (
    <ToolResultPanel title={view.kind === 'move' ? 'File move' : 'File deletion'} call={call} live={live}>
      <div className="flex flex-col gap-3">
        <OperationPath label={view.kind === 'move' ? 'From' : 'Path'} path={view.path} />
        {view.destination !== null ? <OperationPath label="To" path={view.destination} /> : null}
        {view.recursive && view.kind === 'delete' ? (
          <p className="text-caption text-muted-foreground">Includes everything inside this path.</p>
        ) : null}
        {view.overwrite && view.kind === 'move' ? (
          <p className="text-caption text-muted-foreground">Replacing an existing destination is allowed.</p>
        ) : null}
      </div>
      {note ? <p className="whitespace-pre-wrap text-muted-foreground">{note}</p> : null}
    </ToolResultPanel>
  )
}

function OperationPath({ label, path }: { label: string; path: string }) {
  const { name } = splitFilePath(path)
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="w-8 shrink-0 pt-0.5 text-caption text-muted-foreground">{label}</span>
      <FileTypeMark path={path} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="studio-selectable min-w-0 [overflow-wrap:anywhere]">
        <p className="text-ui font-medium">{name}</p>
        {path !== name ? <p className="text-caption text-muted-foreground">{path}</p> : null}
      </div>
    </div>
  )
}
