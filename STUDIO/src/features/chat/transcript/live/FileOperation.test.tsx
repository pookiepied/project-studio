/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { present } from '@/platform/harness/contracts/chunks'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { ToolGroups } from './ToolGroups'
import { fileOperationOf } from './FileOperation'

afterEach(cleanup)

function move(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    toolCallId: 'operation', toolName: 'move',
    input: present({ from: 'src/old.ts', to: 'lib/new.ts' }),
    output: null, errorText: null, ...overrides,
  }
}

function expand(call: ToolCallView, live = false) {
  const result = render(<ToolGroups conversationId="conv" live={live}
    groups={[{ id: 'operation', file: null, calls: [call] }]} />)
  fireEvent.click(screen.getByRole('button'))
  return result
}

describe('file operation disclosures', () => {
  it('shows both endpoints and preserves recovery and created-directory notes without raw fields or a left rule', () => {
    const note = "Created directory lib, which did not exist. This can be undone from this project's snapshot history."
    const { container } = expand(move({ output: present(`Moved src/old.ts to lib/new.ts. ${note}`) }))
    expect(screen.getByRole('region', { name: 'File move' })).toBeTruthy()
    expect(screen.getByText('From')).toBeTruthy()
    expect(screen.getByText('To')).toBeTruthy()
    expect(screen.getAllByText('src/old.ts').length).toBeGreaterThan(0)
    expect(screen.getByText('lib/new.ts')).toBeTruthy()
    expect(screen.getByText(note)).toBeTruthy()
    expect(container.textContent).not.toContain('in:')
    expect(container.textContent).not.toContain('out:')
    expect(container.querySelector('.border-l-2')).toBeNull()
  })

  it('keeps deletion recovery paths intact, even when paths contain punctuation', () => {
    const path = 'C:\\work\\old.to new\\file.txt'
    const note = 'This can be undone: it was moved to the trash at C:\\trash\\entry, its original name and location recorded in origin.json beside it.'
    expand(move({ toolName: 'delete', input: present({ path, recursive: true }), output: present(`Deleted ${path}. ${note}`) }))
    expect(screen.getByRole('region', { name: 'File deletion' })).toBeTruthy()
    expect(screen.getByText(note)).toBeTruthy()
    expect(screen.getByText('Includes everything inside this path.')).toBeTruthy()
  })

  it('distinguishes a live operation from an unanswered historical call', () => {
    const first = expand(move(), true)
    expect(screen.getByRole('status').textContent).toBe('Running')
    first.unmount()
    expand(move())
    expect(screen.getByText('Pending')).toBeTruthy()
  })

  it('reports failure without claiming the file moved or offering recovery', () => {
    expand(move({ errorText: 'The destination already exists.' }))
    expect(screen.getByText('Could not move')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Failed')
    expect(screen.getByText('The destination already exists.')).toBeTruthy()
    expect(screen.queryByText('Moved')).toBeNull()
  })

  it('does not infer replacement or success from overwrite permission or an unfamiliar answer', () => {
    expand(move({ input: present({ from: 'a.ts', to: 'b.ts', overwrite: true }), output: present('Operation skipped.') }))
    expect(screen.getByRole('status').textContent).toBe('Success')
    expect(screen.getByText('Operation skipped.')).toBeTruthy()
    expect(screen.getByText('Replacing an existing destination is allowed.')).toBeTruthy()
  })

  it('preserves the generic inspector for malformed calls and unknown output formats', () => {
    expect(fileOperationOf(move({ input: present({ from: 'a.ts' }) }))).toBeNull()
    expect(fileOperationOf(move({ output: present({ unexpected: 'result' }) }))).toBeNull()
    expect(fileOperationOf(move({ toolName: 'mcp__files__move' }))).toBeNull()
    expand(move({ input: present({ from: 'a.ts' }), output: present('Missing destination') }))
    expect(screen.getByText('Request')).toBeTruthy()
    expect(screen.getByText('Missing destination')).toBeTruthy()
  })
})
