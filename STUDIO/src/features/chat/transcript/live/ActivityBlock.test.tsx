/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantSegment, ToolCallView, TranscriptItem } from '@/features/chat/transcript/projection'
import { ActivityBlock, activitySections } from './ActivityBlock'
import { activityItems } from './activityItems'

vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }))
afterEach(cleanup)

function call(id: string, toolName = 'shell', answered = true): ToolCallView {
  return { toolCallId: id, toolName, input: { present: true, value: { command: id, path: `${id}.ts` } },
    output: answered ? { present: true, value: 'ok' } : null, errorText: null }
}

function tools(id: string, ...calls: ToolCallView[]): Extract<AssistantSegment, { kind: 'tools' }> {
  return { kind: 'tools', id, groups: calls.map((call) => ({ id: call.toolCallId, file: null, calls: [call] })) }
}

const thought: Extract<AssistantSegment, { kind: 'thinking' }> = {
  kind: 'thinking', id: 'thought', text: 'Check the second case.', startedAt: null, updatedAt: null,
}

function message(id: string, segments: readonly AssistantSegment[], submissionId: string | null = 'sub'): Extract<TranscriptItem, { kind: 'assistant' }> {
  return { kind: 'assistant', id, submissionId, segments, model: null, usage: null, end: { state: 'complete' } }
}

describe('activity boundaries and order', () => {
  it('ends a block at visible words, keeping repeated edits on either side', () => {
    const sections = activitySections([tools('before', call('first', 'edit')),
      { kind: 'text', id: 'words', text: 'Now check the other case.' }, tools('after', call('second', 'edit'))])
    expect(sections.map((section) => section.kind)).toEqual(['activity', 'text', 'activity'])
    expect(sections.map((section) => section.id)).toEqual(['before', 'words', 'after'])
  })

  it('keeps reasoning inside the same block and ignores empty text boundaries', () => {
    const sections = activitySections([tools('a', call('first')), thought,
      { kind: 'text', id: 'empty', text: ' \n' }, tools('b', call('second'))])
    expect(sections).toHaveLength(1)
    expect(sections[0]?.kind === 'activity' ? sections[0].segments.map((segment) => segment.id) : []).toEqual(['a', 'thought', 'b'])
  })

  it('joins provider messages in one submission without crossing a user message', () => {
    const first = message('m1', [tools('a', call('one'))])
    const second = message('m2', [thought, tools('b', call('two'))])
    const user: TranscriptItem = { kind: 'user', id: 'u', submissionId: 'sub2', text: 'Next', attachments: [], documents: [], timestamp: null }
    const joined = activityItems([first, second, user, message('m3', [tools('c', call('three'))], 'sub2')])
    expect(joined).toHaveLength(3)
    expect(joined[0]?.id).toBe('m1')
    expect(joined[0]?.tailMessageId).toBe('m2')
    expect(joined[0]?.kind === 'assistant' ? activitySections(joined[0].segments) : []).toHaveLength(1)
  })

  it('does not join unknown submissions, different submissions or failed attempts', () => {
    const first = message('one', [tools('a', call('one'))])
    expect(activityItems([first, message('two', [], 'other')])).toHaveLength(2)
    expect(activityItems([message('one', [], null), message('two', [], null)])).toHaveLength(2)
    expect(activityItems([{ ...first, end: { state: 'failed', reason: 'failure' } }, message('two', [])])).toHaveLength(2)
  })

  it('keeps historical groups stable when an unrelated live message changes', () => {
    const first = message('one', [tools('a', call('one'))])
    const second = message('two', [tools('b', call('two'))])
    const initial = activityItems([first, second, message('live', [], 'other')])
    const updated = activityItems([first, second, message('live', [tools('c', call('three'))], 'other')])
    expect(updated[0]).toBe(initial[0])
    expect(first.segments).toHaveLength(1)
  })
})

describe('the activity disclosure', () => {
  it('starts collapsed and opens a flat chronological list, including repeated tools', () => {
    const { container } = render(<ActivityBlock conversationId="conv" active={false} segments={[
      tools('a', call('first'), call('second', 'edit'), call('third')),
    ]} />)
    const block = screen.getByRole('button', { name: 'Ran commands, changed files' })
    expect(block.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(block)
    const buttons = [...container.querySelectorAll('button[aria-expanded]')]
    expect(buttons).toHaveLength(4)
    expect(buttons.slice(1).map((button) => button.textContent)).toEqual([
      expect.stringContaining('first'), expect.stringContaining('second.ts'), expect.stringContaining('third'),
    ])
  })

  it('updates current activity and retains the reader expansion as calls arrive and finish', () => {
    const view = render(<ActivityBlock conversationId="conv" active segments={[tools('a', call('first', 'shell', false))]} />)
    const block = screen.getByRole('button', { name: /Running first/ })
    fireEvent.click(block)
    view.rerender(<ActivityBlock conversationId="conv" active segments={[tools('a', call('first'), call('second', 'shell', false))]} />)
    expect(screen.getByRole('button', { name: /Running second/ }).getAttribute('aria-expanded')).toBe('true')
    view.rerender(<ActivityBlock conversationId="conv" active={false} segments={[tools('a', call('first'), call('second'))]} />)
    expect(screen.getByRole('button', { name: 'Ran commands' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('reports parallel work and counts failures even while collapsed', () => {
    render(<ActivityBlock conversationId="conv" active segments={[tools('a', call('one', 'read', false),
      call('two', 'shell', false), { ...call('three'), errorText: 'denied' })]} />)
    expect(screen.getByRole('button', { name: /Running two.*Some tools failed/ })).toBeTruthy()
    expect(screen.queryByText(/\d+ tool calls/)).toBeNull()
  })

  it('never claims unfinished calls are running after stop or replay', () => {
    render(<ActivityBlock conversationId="conv" active={false} segments={[tools('a', call('one', 'shell', false))]} />)
    expect(screen.getByRole('button', { name: 'Ran commands Unfinished' })).toBeTruthy()
    expect(screen.queryByText(/running/i)).toBeNull()
  })

  it('keeps thought-only content inspectable without an empty activity block', () => {
    render(<ActivityBlock conversationId="conv" active={false} segments={[thought]} />)
    expect(screen.queryByText(/0 tool/)).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})
