import { describe, expect, it } from 'vitest'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { freshMarkCommands } from './markCalls'

function turn(calls: readonly { id: string; expiresAt?: number; clear?: boolean; tool?: string }[]): TranscriptItem[] {
  return [{
    kind: 'assistant',
    segments: [{ kind: 'tools', groups: [{ calls: calls.map((call) => ({
      toolCallId: call.id,
      toolName: call.tool ?? 'mcp__15_studio-computer__29_studio_computer_mark',
      input: { present: true, value: {} },
      output: { present: true, value: { structuredContent: { marks: call.clear === true ? { clear: true } : { id: call.id, display: { index: 0, x: 0, y: 0, width: 10, height: 10 }, expiresAt: call.expiresAt ?? 0, marks: [{ kind: 'point', x: 1, y: 1 }] } } } },
      errorText: null,
    })) }] }],
  } as unknown as TranscriptItem]
}

describe('the marks to show from a transcript', () => {
  it('shows each new answer once, never one already shown, and never one already expired', () => {
    const items = turn([{ id: 'a', expiresAt: 2000 }, { id: 'b', expiresAt: 500 }, { id: 'c', clear: true }, { id: 'd', expiresAt: 9000, tool: 'mcp__15_studio-computer__3_studio_computer_click' }])
    expect(freshMarkCommands(items, new Set(), 1000).map((call) => call.id)).toEqual(['a', 'c'])
    expect(freshMarkCommands(items, new Set(['a']), 1000).map((call) => call.id)).toEqual(['c'])
  })
})
