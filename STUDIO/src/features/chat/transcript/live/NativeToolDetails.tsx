import { Icons } from '@/components/icons'
import { isRecord } from '@/lib/guards'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { StructuredValue, ToolResultPanel } from './ToolResultPanel'
import { readableName } from './toolResult'

function inputOf(call: ToolCallView): Record<string, unknown> {
  return call.input?.present && isRecord(call.input.value) ? call.input.value : {}
}

export function ShellDetails({ call, live }: { call: ToolCallView; live: boolean }) {
  const input = inputOf(call)
  const command = input['command']
  const cwd = input['cwd']
  const timeout = input['timeoutMs']
  const output: unknown = call.output?.present ? call.output.value : null
  const background = typeof output === 'string' ? /^Started (\S+) in the background:/.exec(output) : null
  const sandboxNote = background !== null && typeof output === 'string' ? /(?:^|\n)\[sandbox\] ([\s\S]*)$/.exec(output)?.[1] : undefined
  return <ToolResultPanel title={call.toolName === 'git' ? 'Git' : 'Shell'} call={call} live={live}>
    {typeof command === 'string' ? (
      <div className="flex min-w-0 items-start gap-2 font-mono text-code">
        <span aria-hidden="true" className="text-muted-foreground">$</span>
        <span className="min-w-0 whitespace-pre-wrap">{command}</span>
      </div>
    ) : call.input?.present ? <StructuredValue value={call.input.value} /> : null}
    {typeof cwd === 'string' || typeof timeout === 'number' ? (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        {typeof cwd === 'string' ? <span>Directory: {cwd}</span> : null}
        {typeof timeout === 'number' ? <span>Timeout: {timeout / 1000}s</span> : null}
      </div>
    ) : null}
    {background !== null ? <div className="text-muted-foreground">
      <p>Job {background[1]}</p><p>Started in the background. It may continue after this turn.</p>
      {sandboxNote !== undefined ? <p className="mt-1 whitespace-pre-wrap">{sandboxNote}</p> : null}
    </div> : call.output?.present ? (
      <div className="font-mono text-code">
        <StructuredValue value={call.output.value} />
      </div>
    ) : null}
  </ToolResultPanel>
}

const PLAN_STATUS: Record<string, string> = {
  pending: 'Pending', running: 'In progress', done: 'Done', failed: 'Failed', cancelled: 'Cancelled',
}

export function PlanDetails({ call, live }: { call: ToolCallView; live: boolean }) {
  // The returned plan includes the person's edits and items omitted by this
  // call. Its complete snapshot takes precedence over requested changes.
  const value: unknown = call.output?.present ? call.output.value : call.input?.present ? call.input.value : null
  const raw = isRecord(value) ? value['items'] : null
  const items = Array.isArray(raw) && raw.every((item: unknown) => isRecord(item) &&
    typeof item['text'] === 'string' && typeof item['status'] === 'string' && Object.hasOwn(PLAN_STATUS, item['status'])) ? raw : null
  return <ToolResultPanel title="Plan" call={call} live={live}>
    {!call.output?.present ? <p className="text-muted-foreground">Requested steps</p> : null}
    {items !== null ? <ol className="flex flex-col gap-2.5">
      {items.map((item: Record<string, unknown>, index) => {
        const status = String(item['status'])
        const Mark = status === 'done' ? Icons.check : status === 'failed' ? Icons.failed : status === 'cancelled' ? Icons.close : Icons.plan
        return <li key={index} className="flex items-start gap-2.5">
          <span className={status === 'failed' ? 'mt-0.5 text-danger' : 'mt-0.5 text-muted-foreground'}><Mark /></span>
          <span className="min-w-0 flex-1">{String(item['text'])}</span>
          <span className={`shrink-0 ${status === 'failed' ? 'text-danger' : 'text-muted-foreground'}`}>{PLAN_STATUS[status]}</span>
        </li>
      })}
    </ol> : value !== null ? <StructuredValue value={value} /> : null}
  </ToolResultPanel>
}

interface DiscoveryEntry { readonly name: string; readonly description: string }

/** Recognises the native catalog's three reports, never guesses from input. */
export function discoveryEntries(output: string): DiscoveryEntry[] {
  const lines = output.split('\n')
  const loaded = lines.filter((line) => /^mcp:[^\s/]+\/[^\s]+(?: - its full definition\.)?$/.test(line))
  if (loaded.length > 0) return loaded.map((line) => ({ name: line.replace(/ - its full definition\.$/, ''), description: '' }))
  const entries: DiscoveryEntry[] = []
  let server: string | null = null
  for (const line of lines) {
    const heading = line.match(/^(mcp:[^\s/]+) - (.*?)(\d+) tools?\.?/)
    if (heading !== null) {
      server = heading[1] ?? null
      entries.push({ name: server ?? '', description: `${heading[3]} tools` })
      continue
    }
    if (server === null || !line.startsWith('  ')) continue
    const text = line.trim()
    const separator = text.indexOf(' - ')
    if (separator >= 0) entries.push({ name: text.slice(0, separator), description: text.slice(separator + 3) })
    else for (const name of text.split(', ')) entries.push({ name, description: '' })
  }
  return entries
}

export function DiscoveryDetails({ call, live }: { call: ToolCallView; live: boolean }) {
  const output: unknown = call.output?.present ? call.output.value : null
  const entries = typeof output === 'string' ? discoveryEntries(output) : []
  const scope = inputOf(call)['scope']
  return <ToolResultPanel title="Tool discovery" call={call} live={live}>
    {typeof scope === 'string' ? <p className="text-muted-foreground">Looking up {readableName(scope.replace(/^mcp:/, ''))}</p> : null}
    {entries.length > 0 ? <ul className="flex flex-col gap-2.5">
      {entries.map((entry, index) => <li key={index} className="flex items-start gap-2.5">
        <span className="mt-0.5 text-muted-foreground"><Icons.mcp /></span>
        <div className="min-w-0">
          <p className="font-medium" title={entry.name}>{readableName(entry.name.replace(/^mcp:/, ''))}</p>
          {entry.description !== '' ? <p className="text-muted-foreground">{entry.description}</p> : null}
        </div>
      </li>)}
    </ul> : output !== null ? <StructuredValue value={output} /> : <p className="text-muted-foreground">Checking available extensions and tools.</p>}
  </ToolResultPanel>
}
