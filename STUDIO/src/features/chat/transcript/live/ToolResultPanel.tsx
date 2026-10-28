import type { ReactNode } from 'react'
import { Icons } from '@/components/icons'
import { isRecord } from '@/lib/guards'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { readableName, resultState, type ResultState } from './toolResult'

const STATUS: Record<ResultState, string> = {
  success: 'Success', failed: 'Failed', running: 'Running', pending: 'Pending', background: 'Started in background',
}

/** One quiet surface, without nested frames or a rule hanging from its row. */
export function ToolResultPanel({ title, call, live, children, statusLabel }: {
  title: string; call: ToolCallView; live: boolean; children: ReactNode; statusLabel?: string
}) {
  const state = resultState(call, live)
  const Mark = state === 'success' ? Icons.check : state === 'failed' ? Icons.failed : Icons.run
  return (
    <section aria-label={title} className="my-1 min-w-0 rounded-lg bg-muted/60 px-3 py-2.5 text-foreground">
      <div className="mb-3 text-caption font-medium text-muted-foreground">{title}</div>
      <div role="region" aria-label={`${title} details`} tabIndex={0}
        className="studio-selectable studio-scroll-bounded flex max-h-80 min-w-0 flex-col gap-3 overflow-auto overscroll-contain text-caption [overflow-wrap:anywhere]">
        {children}
        {call.errorText !== null ? <p className="whitespace-pre-wrap text-danger">{call.errorText}</p> : null}
      </div>
      <div role="status" className={`mt-3 flex items-center justify-end gap-1.5 text-caption ${state === 'failed' ? 'text-danger' : 'text-muted-foreground'}`}>
        <Mark />{statusLabel ?? STATUS[state]}
      </div>
    </section>
  )
}

/** Unknown tools still get readable fields and lists instead of a JSON dump. */
export function StructuredValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">None</span>
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>
  if (typeof value === 'string') return <span className="whitespace-pre-wrap">{value === '' ? 'Empty' : value}</span>
  if (typeof value === 'number' || typeof value === 'bigint') return <span>{String(value)}</span>
  if (typeof value === 'symbol') return <span>{value.description ?? 'Symbol'}</span>
  if (typeof value === 'function') return <span className="text-muted-foreground">Unavailable</span>
  // Extremely deep provider payloads remain available through a disclosure.
  if (depth > 5) return <details><summary>More details</summary><StructuredValue value={value} /></details>
  if (Array.isArray(value)) return value.length === 0 ? <span className="text-muted-foreground">No items</span> : (
    <ul className="flex min-w-0 flex-col gap-2">
      {value.map((item: unknown, index) => <li key={index}><StructuredValue value={item} depth={depth + 1} /></li>)}
    </ul>
  )
  if (!isRecord(value)) return <span className="text-muted-foreground">No details</span>
  const entries = Object.entries(value)
  if (entries.length === 0) return <span className="text-muted-foreground">No details</span>
  return (
    <dl className="grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2">
      {entries.map(([key, item]) => <div key={key} className="contents">
        <dt className="text-muted-foreground">{readableName(key)}</dt>
        <dd className="min-w-0"><StructuredValue value={item} depth={depth + 1} /></dd>
      </div>)}
    </dl>
  )
}

export function GenericToolDetails({ call, live, request }: { call: ToolCallView; live: boolean; request?: ReactNode }) {
  return <ToolResultPanel title={readableName(call.toolName)} call={call} live={live}>
    {request ?? (call.input?.present ? <div><p className="mb-1 text-muted-foreground">Request</p><StructuredValue value={call.input.value} /></div> : null)}
    {call.output?.present ? <div><p className="mb-1 text-muted-foreground">Result</p><ToolOutput value={call.output.value} /></div> : null}
  </ToolResultPanel>
}

/** MCP transport envelopes are not part of the user's result. */
export function ToolOutput({ value }: { value: unknown }) {
  const content: unknown = isRecord(value) ? value['content'] : value
  if (Array.isArray(content) && content.every((block: unknown) => isRecord(block) && typeof block['type'] === 'string')) {
    return <div className="flex min-w-0 flex-col gap-2">{content.map((block: Record<string, unknown>, index) => {
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        let text: unknown = block['text']
        if (/^\s*[{[]/.test(block['text'])) { try { text = JSON.parse(block['text']) as unknown } catch { /* Plain text remains readable. */ } }
        return <StructuredValue key={index} value={text} />
      }
      if (block['type'] === 'image' && typeof block['data'] === 'string' &&
        typeof block['mimeType'] === 'string' && /^image\/(png|jpeg|webp|gif)$/.test(block['mimeType'])) {
        return <img key={index} src={`data:${block['mimeType']};base64,${block['data']}`} alt="Tool result" className="max-h-72 max-w-full rounded-md object-contain" />
      }
      if (block['type'] === 'attachment') return <span key={index} className="text-muted-foreground">Attachment returned</span>
      return <StructuredValue key={index} value={block} />
    })}{isRecord(value) && value['structuredContent'] !== undefined ? <StructuredValue value={value['structuredContent']} /> : null}</div>
  }
  return <StructuredValue value={value} />
}
