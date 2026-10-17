/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { present } from '@/platform/harness/contracts/chunks'
import type { ToolCallView, TranscriptItem } from '@/features/chat/transcript/projection'
import { RailProvider, useRail } from '@/stores/rail'
import { ChangesPanel } from '@/features/changes/ChangesPanel'
import { AssistantTurn } from './AssistantTurn'
import { WorkResults } from './WorkResults'

vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
afterEach(cleanup)
function edit(index: number): ToolCallView {
  return { toolCallId: `edit-${index}`, toolName: 'edit', input: present({ path: `file-${index}.ts`, oldString: 'old value', newString: 'new value' }), output: present(`Edited file-${index}.ts`), errorText: null }
}
function RailProbe() {
  const { entries, activeId } = useRail()
  const entry = entries.find((entry) => entry.id === activeId)
  return entry?.kind === 'changes' ? <aside aria-label="File review"><ChangesPanel changes={entry.changes} conversationId={entry.conversationId} /></aside> : null
}

describe('completed work and its results', () => {
  it('shows the live transcript without an outer title or divider, folding only after settlement', () => {
    const item: Extract<TranscriptItem, { kind: 'assistant' }> = {
      kind: 'assistant', id: 'live-work', submissionId: 'turn', model: null, usage: null, end: { state: 'complete' },
      segments: [{ kind: 'text', id: 'intro', text: 'I am changing the startup handler.' },
        { kind: 'tools', id: 'tools', groups: [{ id: 'edit', file: null, calls: [edit(1)] }] },
        { kind: 'text', id: 'final', text: 'Fixed the startup bug. All checks passed.' }],
    }
    const view = render(<RailProvider><AssistantTurn item={item} conversationId="conv" live={false} turnInFlight /></RailProvider>)
    expect(screen.queryByRole('button', { name: 'Work in progress' })).toBeNull()
    expect(screen.getByText('I am changing the startup handler.')).toBeTruthy()
    expect(view.container.querySelector('hr')).toBeNull()
    view.rerender(<RailProvider><AssistantTurn item={{ ...item, end: { state: 'stopped' }, segments: item.segments.slice(0, 2).map((segment) => segment.kind === 'tools'
      ? { ...segment, groups: [{ id: 'edit', file: null, calls: [{ ...edit(1), output: null }] }] } : segment) }} conversationId="conv" live turnInFlight /></RailProvider>)
    expect(screen.queryByRole('button', { name: 'Work in progress' })).toBeNull()
    expect(screen.getByText('I am changing the startup handler.')).toBeTruthy()
    expect(view.container.querySelector('hr')).toBeNull()
    view.rerender(<RailProvider><AssistantTurn item={item} conversationId="conv" live={false} /></RailProvider>)
    expect(screen.getByRole('button', { name: 'Updated file-1.ts' }).getAttribute('aria-expanded')).toBe('false')
    expect(view.container.querySelector('hr')).not.toBeNull()
    expect(screen.getByText(/All checks passed/)).toBeTruthy()
  })
  it('shows three files, expands the rest, and opens the real rail review without Undo', () => {
    render(<RailProvider><WorkResults conversationId="conv" resultId="turn" calls={[1, 2, 3, 4].map(edit)} /><RailProbe /></RailProvider>)
    expect(screen.queryByText('file-4.ts')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more file' }))
    expect(screen.getByText('file-4.ts')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View changes' }))
    expect(screen.getByRole('complementary', { name: 'File review' })).toBeTruthy()
    expect(screen.getAllByRole('region', { name: /Changes to file-/ })).toHaveLength(4)
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull()
  })
  it('keeps final text visible while completed work and its narration start collapsed', () => {
    const item: Extract<TranscriptItem, { kind: 'assistant' }> = {
      kind: 'assistant', id: 'message', submissionId: 'turn', model: null, usage: null, end: { state: 'complete' },
      segments: [
        { kind: 'text', id: 'intro', text: 'I will inspect the old code.' },
        { kind: 'tools', id: 'tools', groups: [{ id: 'edit', file: null, calls: [edit(1)] }] },
        { kind: 'text', id: 'final', text: 'Fixed the startup bug. All checks passed.' },
      ],
    }
    const view = render(<RailProvider><AssistantTurn item={item} conversationId="conv" live={false} /></RailProvider>)
    expect(screen.getByRole('button', { name: 'Updated file-1.ts' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText(/All checks passed/)).toBeTruthy()
    expect(screen.queryByText('I will inspect the old code.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Updated file-1.ts' }))
    expect(screen.getByText('I will inspect the old code.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Changed files' })).toBeTruthy()
    expect(view.container.querySelector('.border-l-2')).toBeNull()
    view.rerender(<RailProvider><AssistantTurn item={item} conversationId="conv" live={false} turnInFlight /></RailProvider>)
    expect(screen.queryByRole('button', { name: 'Updated file-1.ts' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Recorded file changes' })).toBeNull()
  })
  it('keeps an image conversation as an activity group and a reply, without a task title', () => {
    const thought = { kind: 'thinking' as const, id: 'thought-one', text: 'Inspect the photo.', startedAt: null, updatedAt: null }
    const read: ToolCallView = { toolCallId: 'read', toolName: 'read', input: present({ path: 'photo.png' }), output: present('Attached image/png'), errorText: null }
    const item: Extract<TranscriptItem, { kind: 'assistant' }> = {
      kind: 'assistant', id: 'photo-reply', submissionId: 'photo-turn', model: null, usage: null, end: { state: 'complete' },
      segments: [thought, { kind: 'tools', id: 'read-tools', groups: [{ id: 'read', file: null, calls: [read] }] },
        { ...thought, id: 'thought-two' }, { kind: 'text', id: 'final', text: 'Yes—I can see the image itself.' }],
    }
    const view = render(<AssistantTurn item={item} conversationId="conv" live={false} />)
    expect(screen.getByRole('button', { name: 'Read files' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Yes—I can see the image itself' })).toBeNull()
    expect(screen.getAllByText('Yes—I can see the image itself.')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Read files' }))
    expect(screen.getAllByRole('button', { name: 'Thought' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Read.*photo.png/ }).hasAttribute('disabled')).toBe(true)
    view.rerender(<AssistantTurn item={item} conversationId="conv" live={false} turnInFlight />)
    expect(screen.queryByRole('button', { name: 'Work in progress' })).toBeNull()
  })
  it('offers only actual returned web URLs and deduplicates browser results', () => {
    const browser: ToolCallView = { toolCallId: 'browser', toolName: 'mcp__studio_browser_open', input: present({ url: 'http://localhost:3000' }),
      output: present({ content: [{ type: 'text', text: 'Opened.\nTab: tab-1\nURL: http://localhost:3000/\nTitle: Studio preview' }] }), errorText: null }
    const { rerender } = render(<RailProvider><WorkResults conversationId="conv" resultId="turn" calls={[browser, { ...browser, toolCallId: 'again' }]} /></RailProvider>)
    expect(screen.getAllByRole('region', { name: 'Web preview' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Open web preview: Studio preview' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open in' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
    rerender(<RailProvider><WorkResults conversationId="conv" resultId="turn" calls={[{ ...browser, output: null }]} /></RailProvider>)
    expect(screen.queryByRole('region', { name: 'Web preview' })).toBeNull()
    rerender(<RailProvider><WorkResults conversationId="conv" resultId="turn" calls={[{ ...browser, output: present({ content: [{ type: 'text', text: 'URL: javascript:alert(1)' }] }) }]} /></RailProvider>)
    expect(screen.queryByRole('region', { name: 'Web preview' })).toBeNull()
  })
  it('retains a native computer screenshot outside the collapsed working history', () => {
    const screenshot: ToolCallView = { toolCallId: 'screen', toolName: 'mcp__15_studio-computer__26_studio_computer_screenshot', input: present({}),
      output: present({ content: [{ type: 'text', text: 'Screenshot taken.' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] }), errorText: null }
    render(<WorkResults conversationId="conv" resultId="turn" calls={[screenshot]} />)
    expect(screen.getByRole('region', { name: 'Computer screenshot' })).toBeTruthy()
    expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })
})
