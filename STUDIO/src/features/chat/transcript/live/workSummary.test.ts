import { describe, expect, it } from 'vitest'
import { present } from '@/platform/harness/contracts/chunks'
import type { AssistantSegment, ToolCallView, TranscriptItem } from '@/features/chat/transcript/projection'
import { activityItems } from './activityItems'
import { finalTextStart, workSummary } from './workSummary'
import { activitySummary } from './activitySummary'

const intro: AssistantSegment = { kind: 'text', id: 'intro', text: 'I will check the files.' }
const called: ToolCallView = { toolCallId: 'call', toolName: 'edit', input: present({ path: 'search.ts', oldString: 'old', newString: 'fixed' }), output: present('Edited search.ts'), errorText: null }
const tools: AssistantSegment = { kind: 'tools', id: 'tools', groups: [{ id: 'call', file: null, calls: [called] }] }
const answer: AssistantSegment = { kind: 'text', id: 'answer', text: 'Fixed the search bug. The tests pass.' }

function message(id: string, segments: AssistantSegment[]): Extract<TranscriptItem, { kind: 'assistant' }> {
  return { kind: 'assistant', id, submissionId: 'turn', segments, model: null, usage: null, end: { state: 'complete' } }
}

describe('work summary boundaries', () => {
  it('leaves a normal conversation alone and requires actual answered tool work', () => {
    expect(workSummary([answer], answer.id)).toBeNull()
    expect(workSummary([{ ...tools, groups: [{ id: 'pending', file: null, calls: [{ ...called, output: null }] }] }, answer], answer.id)).toBeNull()
  })
  it('titles the recorded work independently of the answer, leaving the final text intact', () => {
    const summary = workSummary([intro, tools, answer], finalTextStart([intro, tools, answer]))
    expect(summary?.title).toBe('Updated search.ts')
    expect(summary?.activity).toEqual([intro, tools])
    expect(summary?.final).toEqual([answer])
    expect(workSummary([intro, tools, { ...answer, text: '## Summary' }], answer.id)?.title).toBe('Updated search.ts')
    const demo = { ...answer, text: 'That is the full seven file tools exercised in one pass.' }
    expect(workSummary([intro, tools, demo], demo.id)?.title).toBe('Updated search.ts')
    expect(workSummary([intro, tools, demo], demo.id)?.final).toEqual([demo])
  })
  it('uses the last provider message boundary even if earlier commentary followed the final tool', () => {
    const commentary: AssistantSegment = { ...intro, id: 'after-tools', text: 'I am checking the result.' }
    const joined = activityItems([message('first', [intro, tools, commentary]), message('last', [answer])])[0]
    expect(joined?.finalTextStartId).toBe('answer')
    if (joined?.kind !== 'assistant') throw new Error('Expected assistant')
    expect(workSummary(joined.segments, joined.finalTextStartId ?? null)?.activity).toEqual([intro, tools, commentary])
  })
  it('deduplicates activity verbs without numeric tool counters', () => {
    const command = { ...called, toolName: 'shell' }
    expect(activitySummary([command, command, called])).toBe('Ran commands, changed files')
  })
  it('does not title a photo conversation with a read and two reasoning runs', () => {
    const thought: AssistantSegment = { kind: 'thinking', id: 'thought-one', text: 'Inspect the image.', startedAt: null, updatedAt: null }
    const read: AssistantSegment = { ...tools, groups: [{ id: 'read', file: null, calls: [{ ...called, toolName: 'read', input: present({ path: 'photo.png' }), output: present('Attached image/png') }] }] }
    const reply: AssistantSegment = { ...answer, text: 'Yes—I can see the image itself.' }
    expect(workSummary([thought, read, { ...thought, id: 'thought-two' }, reply], reply.id)).toBeNull()
  })
  it('retains the task summary for produced media and excludes failed file changes', () => {
    const image: AssistantSegment = { ...tools, groups: [{ id: 'image', file: null, calls: [{ ...called, toolName: 'studio_image',
      output: present('Artifact: /api/media/artifacts/conv/media_ab12-0.png (image/png)') }] }] }
    expect(workSummary([image, answer], answer.id)).not.toBeNull()
    const failed: AssistantSegment = { ...tools, groups: [{ id: 'failed', file: null, calls: [{ ...called, errorText: 'Permission denied' }] }] }
    expect(workSummary([failed, answer], answer.id)).toBeNull()
  })
  it.each(['read', 'glob', 'grep', 'shell', 'git', 'plan', 'discover', 'task', 'jobs'])(
    'does not infer a completed task from %s calls or a task-like answer alone', (toolName) => {
      const activity: AssistantSegment = { ...tools, groups: [{ id: 'a', file: null, calls: Array.from({ length: 12 }, (_, i) => ({ ...called, toolCallId: String(i), toolName })) }] }
      expect(workSummary([activity, answer], answer.id)).toBeNull()
    },
  )
})
