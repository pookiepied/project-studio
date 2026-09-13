/**
 * How one message's tool calls arrange into rows: a row per maximal
 * same-file run of mutating calls, a row per call otherwise. Both halves are
 * facts already in the log - the tool name and the path in the call's own
 * input - and no label the model did not emit is ever added.
 */

import { isRecord } from '@/lib/guards'
import type { Present } from '@/platform/harness'
import type { ToolCallView, ToolGroupView } from './shapes'

/** The tools whose effect is mutating the file their path names. */
export const FILE_MUTATING: ReadonlySet<string> = new Set(['edit', 'write'])

/** The path a mutating call acts on, or null -- read by field name, never guessed. */
export function fileOf(toolName: string, input: Present<unknown> | null): string | null {
  if (!FILE_MUTATING.has(toolName)) return null
  return pathFrom(input)
}

/** The path a read names, or null -- the other half of the transparency question. */
export function readPathOf(toolName: string, input: Present<unknown> | null): string | null {
  if (toolName !== 'read') return null
  return pathFrom(input)
}

export function pathFrom(input: Present<unknown> | null): string | null {
  if (input === null || !input.present) return null
  const value: unknown = input.value
  if (!isRecord(value)) return null
  for (const key of ['path', 'file_path']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return null
}

/**
 * Opens a new row for one call in a segment's list. Merging is not this
 * function's business any more: a call that continues a run merges into the
 * row the run's own memory points at, wherever that row sits; a call that
 * breaks one starts here, at the end of the story.
 */
export function pushCall(
  rows: readonly ToolGroupView[],
  segmentId: string,
  call: ToolCallView,
): { readonly rows: readonly ToolGroupView[]; readonly row: number; readonly call: number } {
  const row: ToolGroupView = {
    id: `${segmentId}#row-${rows.length}`,
    calls: [call],
    file: fileOf(call.toolName, call.input),
  }
  return { rows: [...rows, row], row: rows.length, call: 0 }
}
