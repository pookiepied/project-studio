/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantSegment, ToolCallView, TranscriptItem } from '@/features/chat/transcript/projection'
import { ActivityBlock, activitySections } from './ActivityBlock'
import { activityItems } from './activityItems'
import { activityState } from './activitySummary'
import { Icons } from '@/components/icons'
import { Arriving } from '@/components/motion/Arrive'

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
  it('places pending, failed and completed media outside activity without losing call order', () => {
    for (const media of [call('image', 'studio_image', false),
      { ...call('image', 'studio_image'), errorText: 'Provider failed' }, call('image', 'studio_image')]) {
      const sections = activitySections([tools('mixed', call('before'), media, call('after'))])
      expect(sections.map((section) => section.kind)).toEqual(['activity', 'artifact', 'activity'])
      expect(sections[1]?.id).toBe('image')
    }
  })

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
  it('spaces every row in an open group the same, whichever kinds they are', () => {
    render(<ActivityBlock conversationId="conv" active={false} segments={[
      thought, tools('a', call('one'), call('two')), { ...thought, id: 'later' },
    ]} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))

    const region = screen.getByRole('region', { name: 'Tool activity' })
    expect(region.classList.contains('gap-2')).toBe(true)
    const [first, group, last] = [...region.children]
    expect(group?.classList.contains('gap-2')).toBe(true)
    for (const row of [first, group, last]) {
      expect(row?.className ?? '').not.toMatch(/(?:^|\s)m[tby]-/)
    }
  })

  it('keeps a long running command to one line', () => {
    const command = `curl -s "https://example.test/${'path/'.repeat(40)}" | head -c 400`
    render(<ActivityBlock conversationId="conv" active segments={[
      tools('a', { ...call('one', 'shell', false), input: { present: true, value: { command } } }),
    ]} />)

    const label = screen.getByRole('button', { expanded: false }).querySelector('.truncate')
    expect(label).not.toBeNull()
    expect(label?.parentElement?.classList.contains('flex-wrap')).toBe(false)
  })

  it('gives a thought that stands alone the one row gap, and no margin of its own', () => {
    // A thought used to keep a bottom margin while a question row beside it
    // kept none, so the gap between two rows depended on which came first.
    const alone = render(<ActivityBlock conversationId="conv" active={false} segments={[thought]} />)
    expect(alone.container.firstElementChild?.className ?? '').not.toMatch(/(?:^|\s)m[tby]-/)
    alone.unmount()

    const below = render(<ActivityBlock conversationId="conv" active={false} rowBefore segments={[thought]} />)
    expect(below.container.firstElementChild?.classList.contains('mt-2')).toBe(true)
    below.unmount()

    const beforeWords = render(<ActivityBlock conversationId="conv" active={false} textAfter segments={[thought]} />)
    expect(beforeWords.container.firstElementChild?.classList.contains('mb-4')).toBe(true)
  })

  it('keeps space around activity while words and tool results arrive', () => {
    const view = render(<Arriving live><ActivityBlock conversationId="conv" active textBefore textAfter segments={[
      tools('a', call('search', 'web_search', false)),
    ]} /></Arriving>)
    const row = screen.getByRole('button', { name: 'Researching the web' }).parentElement
    expect(row?.classList.contains('mt-4')).toBe(true)
    expect(row?.classList.contains('mb-4')).toBe(true)
    expect(row?.querySelector('svg')?.classList.contains('studio-mark-browserUse')).toBe(true)
    view.rerender(<Arriving live><ActivityBlock conversationId="conv" active textBefore textAfter segments={[
      tools('a', call('search', 'web_search')),
    ]} /></Arriving>)
    expect(screen.getByRole('button', { name: 'Researched the web' }).parentElement).toBe(row)
    expect(row?.classList.contains('mt-4')).toBe(true)
    expect(row?.classList.contains('mb-4')).toBe(true)
    view.rerender(<Arriving live={false}><ActivityBlock conversationId="conv" active={false} textBefore textAfter segments={[
      tools('a', call('search', 'web_search')),
    ]} /></Arriving>)
    expect(screen.getByRole('button', { name: 'Researched the web' }).parentElement).toBe(row)
  })

  it('uses the group family mark rather than a command mark', () => {
    for (const [tool, mark] of [
      ['web_search', Icons.browserUse], ['fetch', Icons.browserUse],
      ['edit', Icons.edit], ['plan', Icons.plan], ['task', Icons.branch],
      ['studio_image', Icons.image], ['studio_video', Icons.video],
      ['activate_skill', Icons.skill],
      ['read_skill_resource', Icons.fileRead], ['voice_work', Icons.voice], ['task_activity', Icons.backgroundJobs],
      ['unknown_extension', Icons.mcp],
    ] as const) {
      expect(activityState([call('one', tool)], false).mark).toBe(mark)
    }
  })

  it('keeps all group categories and a stable mark across parallel results and replay', () => {
    const first = call('search', 'web_search', false)
    const second = call('edit', 'edit', false)
    const initial = activityState([first, second], true)
    expect(initial.mark).toBe(Icons.browserUse)
    expect(initial.current).toBe(second)
    const updated = activityState([call('search', 'web_search'), second, call('command')], true)
    expect(updated.mark).toBe(initial.mark)
    expect(updated.summary).toBe('Researched the web, changed files, ran commands')
    expect(updated.current).toBe(second)
    const replay = activityState([first, { ...second, errorText: 'denied' }], false)
    expect(replay.mark).toBe(initial.mark)
    expect(replay.current).toBeUndefined()
    expect(replay.failed).toBe(1)
    expect(replay.unfinished).toBe(true)
  })

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
