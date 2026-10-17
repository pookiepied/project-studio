import { describe, expect, it } from 'vitest'
import { present } from '@/platform/harness/contracts/chunks'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { recordedChanges } from './recordedChanges'

function edit(id: string, oldString = 'one', newString = 'two'): ToolCallView {
  return { toolCallId: id, toolName: 'edit', input: present({ path: 'a.ts', oldString, newString }), output: present('Edited a.ts'), errorText: null }
}

describe('recorded file review', () => {
  it('coalesces repeated edits and shows their provable net rather than summed churn', () => {
    const changes = recordedChanges([edit('one'), edit('two', 'two', 'one')])
    expect(changes).toHaveLength(1)
    expect(changes[0]?.calls).toHaveLength(2)
    expect(changes[0]?.diff?.added).toBe(0)
    expect(changes[0]?.diff?.removed).toBe(0)
  })
  it('excludes failed, unanswered, read and shell calls', () => {
    expect(recordedChanges([
      { ...edit('a'), errorText: 'Denied' }, { ...edit('b'), output: null },
      { ...edit('c'), toolName: 'read' }, { ...edit('d'), toolName: 'shell' },
      { ...edit('e'), output: present({ isError: true }) },
    ])).toEqual([])
  })
  it('carries edit history across a move and retains deletions', () => {
    const move: ToolCallView = { ...edit('move'), toolName: 'move', input: present({ from: 'a.ts', to: 'b.ts' }), output: present('Moved a.ts to b.ts.') }
    const changes = recordedChanges([edit('one'), move, { ...edit('delete'), toolName: 'delete', input: present({ path: 'c.ts' }), output: present('Deleted c.ts.') }])
    expect(changes.map((change) => [change.path, change.action])).toEqual([['b.ts', 'Moved'], ['c.ts', 'Deleted']])
    expect(changes[0]?.calls).toHaveLength(2)
  })
  it('does not invent a comparison for replaced whole files', () => {
    const write: ToolCallView = { ...edit('write'), toolName: 'write', input: present({ path: 'a.ts', content: 'new contents' }), output: present('Replaced a.ts') }
    expect(recordedChanges([write])[0]?.diff).toBeNull()
    expect(recordedChanges([{ ...write, output: present('Created a.ts') }])[0]?.diff?.added).toBe(1)
  })
})
