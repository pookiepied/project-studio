import { FileTypeMark } from '@/components/icons/fileTypes'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { answerText } from '../callText'
import { StructuredValue, ToolOutput, ToolResultPanel } from '../ToolResultPanel'

export interface LibraryEntry { title: string; kind: string; filename: string; details: string[]; path: string | null }

export function libraryEntries(text: string): LibraryEntry[] {
  const entries: LibraryEntry[] = []
  let current: LibraryEntry | undefined
  for (const line of text.split('\n')) {
    const heading = line.match(/^- (.+) \((image|document|audio|video|other), (.+), id (.+)\)$/)
    if (heading !== null) {
      current = { title: heading[1] ?? '', kind: heading[2] ?? '', filename: heading[3] ?? '', details: [], path: null }
      entries.push(current)
    } else if (current !== undefined && line.startsWith('  ')) {
      if (line.trim().startsWith('Path: ')) current.path = line.trim().slice(6)
      else current.details.push(line.trim())
    }
  }
  return entries
}

export function LibraryDetails({ call, live }: { call: ToolCallView; live: boolean }) {
  const output: unknown = call.output?.present ? call.output.value : null
  const entries = libraryEntries(answerText(output))
  return <ToolResultPanel title={call.toolName === 'library_keep' ? 'Library save' : 'Library search'} call={call} live={live}>
    {call.input?.present ? <StructuredValue value={call.input.value} /> : null}
    {entries.length > 0 ? <ul className="flex flex-col gap-3">{entries.map((entry, index) => <li key={index} className="flex items-start gap-2.5">
      <FileTypeMark path={entry.filename} className="mt-0.5" />
      <div className="min-w-0"><p className="font-medium">{entry.title}</p>
        <p className="text-muted-foreground">{entry.filename} · {entry.kind}</p>
        {entry.details.map((detail, i) => <p key={i} className="text-muted-foreground">{detail}</p>)}
        {entry.path !== null ? <p className="break-all text-muted-foreground">{entry.path}</p> : null}
      </div>
    </li>)}</ul> : output !== null ? <ToolOutput value={output} /> : null}
  </ToolResultPanel>
}
