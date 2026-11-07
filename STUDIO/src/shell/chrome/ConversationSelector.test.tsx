/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConversationStatus } from '@/stores/status'
import { ConversationSelector } from './ConversationSelector'

const statuses = vi.hoisted(() => ({ current: new Map<string, string>() }))

const row = (id: string, archived = false) => ({
  id,
  title: `Title ${id}`,
  projectId: null,
  updatedAt: 1,
  pinned: false,
  archived,
})

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({ conversations: [row('a'), row('b'), row('old', true)], projects: [] }),
}))
vi.mock('@/stores/navigation', () => ({ useNavigation: () => ({ openChat: vi.fn(), openProject: vi.fn() }) }))
vi.mock('@/stores/status', () => ({ useConversationStatuses: () => statuses.current }))

const set = (entries: readonly (readonly [string, ConversationStatus])[]) => {
  statuses.current = new Map(entries)
}
const selector = () => render(<ConversationSelector title="Title a" currentId="a" />)
const dot = () => document.querySelector('[data-status-dot]')?.getAttribute('data-status-dot') ?? null

beforeEach(() => set([]))
afterEach(cleanup)

describe('the conversation selector', () => {
  it('marks each row with its status', () => {
    set([['b', 'input']])
    selector()
    fireEvent.click(screen.getByRole('button', { name: /^Conversations/ }))

    expect(screen.getByRole('menuitemradio', { name: /Title b.*Needs your answer/ })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'Title a' })).toBeTruthy()
  })

  it('shows a running mark, not the check, on the open conversation while it works', () => {
    set([['a', 'running']])
    selector()
    fireEvent.click(screen.getByRole('button', { name: /^Conversations/ }))

    const row = screen.getByRole('menuitemradio', { name: /Title a.*Working/ })
    expect(row.getAttribute('aria-checked')).toBe('true')
    expect(row.className).toContain('bg-selected')
    expect(row.querySelector('.studio-mark-check')).toBeNull()
  })

  it('keeps the check on the open conversation when it has nothing to report', () => {
    selector()
    fireEvent.click(screen.getByRole('button', { name: /^Conversations/ }))

    expect(screen.getByRole('menuitemradio', { name: 'Title a' }).querySelector('.studio-mark-check')).not.toBeNull()
  })

  it('shows a dot on the button for another conversation that wants you', () => {
    set([['b', 'done']])
    selector()
    expect(dot()).toBe('done')
    cleanup()

    set([['b', 'input']])
    selector()
    expect(dot()).toBe('input')
  })

  it('shows no dot for a run, the open conversation, or an archived one', () => {
    set([['a', 'input'], ['b', 'running'], ['old', 'done']])
    selector()
    expect(dot()).toBeNull()
  })
})
