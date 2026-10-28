import { describe, expect, it } from 'vitest'
import { activityTitle, workspaceTasks } from './workspaceTasks'
import type { TranscriptItem, ToolCallView } from '@/features/chat/transcript/projection'

function call(id: string, toolName = 'shell'): ToolCallView {
  return { toolCallId: id, toolName, input: { present: true, value: { command: 'secret command', path: '/private/path' } }, output: { present: true, value: 'ok' }, errorText: null }
}
function message(id: string, submissionId = 'submission', end: 'complete' | 'stopped' = 'complete'): Extract<TranscriptItem, { kind: 'assistant' }> {
  return { kind: 'assistant', id, submissionId, model: null, usage: null, end: { state: end }, segments: [{ kind: 'tools', id: `tools:${id}`, groups: [{ id, file: null, calls: [call(id)] }] }] }
}

describe('conversation workspace projection', () => {
  it('groups provider messages by their originating submission and retains call identities', () => {
    const items = [message('one'), message('two'), message('three', 'other')]
    const tasks = workspaceTasks('conversation', items, false)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]?.calls.map((item) => item.toolCallId)).toEqual(['one', 'two'])
    expect(tasks.every((task) => task.conversationId === 'conversation')).toBe(true)
    expect(workspaceTasks('conversation', items, false)).toEqual(tasks)
  })
  it('keeps a closed model message running until its active submission settles', () => {
    const items = [message('one')]
    expect(workspaceTasks('c', items, true, 'submission')[0]?.status).toBe('running')
    expect(workspaceTasks('c', items, false)[0]?.status).toBe('completed')
    expect(workspaceTasks('c', items, true, 'new-submission')[0]?.status).toBe('completed')
  })
  it('does not turn an interrupted history into completed work', () => {
    expect(workspaceTasks('c', [message('one', 's', 'stopped')], false)[0]?.status).toBe('interrupted')
  })
  it('preserves failed and cancelled submissions even without assistant output', () => {
    expect(workspaceTasks('c', [{ kind: 'submission-failed', id: 'failure', submissionId: 's', outcome: 'failed', reason: 'offline' }], false)[0]?.status).toBe('failed')
    expect(workspaceTasks('c', [{ kind: 'submission-failed', id: 'failure', submissionId: 's', outcome: 'aborted', reason: null }], false)[0]?.status).toBe('cancelled')
  })
  it('never turns raw commands, arguments or function names into task labels', () => {
    expect(activityTitle([call('one')])).toBe('Running project commands')
    expect(activityTitle([call('one', 'mcp__private_function')])).toBe('Using connected tools')
  })
  it('retains large histories with stable submission identities', () => {
    const tasks = workspaceTasks('c', Array.from({ length: 1000 }, (_, index) => message(`m${index}`, `s${index}`)), false)
    expect(tasks).toHaveLength(1000)
    expect(new Set(tasks.map((task) => task.id)).size).toBe(1000)
  })
})
