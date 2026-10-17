import type { AssistantSegment } from '@/features/chat/transcript/projection'
import { workTitle } from './workTitle'
import { callsIn, hasTaskResult } from './taskEvidence'

/** Last provider message: everything written after its last tool is its answer. */
export function finalTextStart(segments: readonly AssistantSegment[]): string | null {
  let lastTool = -1
  segments.forEach((segment, index) => { if (segment.kind === 'tools') lastTool = index })
  return segments.slice(lastTool + 1).find((segment) => segment.kind === 'text' && segment.text.trim() !== '')?.id ?? null
}

export function workSummary(segments: readonly AssistantSegment[], finalId: string | null) {
  const calls = callsIn(segments)
  if (!hasTaskResult(calls)) return null
  if (calls.some((call) => call.errorText === null && !call.output?.present)) return null
  const at = finalId === null ? segments.length : segments.findIndex((segment) => segment.id === finalId)
  if (at < 0) return null
  const final = segments.slice(at)
  return { title: workTitle(calls), activity: segments.slice(0, at), final, calls }
}
