/**
 * One row per call, preserving arrival order and the call's own file path.
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
 * Opens a row at the end, including repeated calls against the same file.
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
