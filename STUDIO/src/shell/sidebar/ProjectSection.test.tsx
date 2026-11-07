/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Conversation } from '@/domain/conversation/types'
import type { Project } from '@/domain/projects/types'
import { ProjectSection } from './ProjectSection'

type Route = { kind: 'home' } | { kind: 'chat'; conversationId: string } | { kind: 'project'; projectId: string }

const navigation: { route: Route; openProject: () => void } = { route: { kind: 'home' }, openProject: vi.fn() }

vi.mock('@/stores/navigation', () => ({ useNavigation: () => navigation }))
vi.mock('@/stores/workspace', () => ({ useWorkspace: () => ({ removeProject: vi.fn() }) }))
vi.mock('@/shell/sidebar/ConversationRow', () => ({
  ConversationRow: ({ conversation }: { conversation: Conversation }) => <p>{conversation.title}</p>,
}))

const PROJECT = { id: 'prj_1', name: 'Project Studio', icon: 'arc' } as unknown as Project
const conversations = (count: number) =>
  Array.from({ length: count }, (_, at) => ({ id: `cnv_${at}`, title: `Chat ${at}` })) as unknown as Conversation[]

beforeEach(() => {
  navigation.route = { kind: 'home' }
})

afterEach(cleanup)

describe('a long project', () => {
  it('stops at five conversations and offers the rest', () => {
    render(<ProjectSection project={PROJECT} conversations={conversations(8)} />)

    expect(screen.getByText('Chat 4')).toBeTruthy()
    expect(screen.queryByText('Chat 5')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more' }))
    expect(screen.getByText('Chat 7')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.queryByText('Chat 7')).toBeNull()
  })

  it('offers nothing when everything fits', () => {
    render(<ProjectSection project={PROJECT} conversations={conversations(5)} />)
    expect(screen.queryByRole('button', { name: /^Show/ })).toBeNull()
  })

  it('never hides the open conversation', () => {
    navigation.route = { kind: 'chat', conversationId: 'cnv_7' }
    render(<ProjectSection project={PROJECT} conversations={conversations(8)} />)

    expect(screen.getByText('Chat 7')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show less' })).toBeNull()
  })
})

describe('the project row', () => {
  it('folds its conversations away and back', async () => {
    render(<ProjectSection project={PROJECT} conversations={conversations(1)} />)
    const row = screen.getByRole('button', { name: 'Project Studio' })
    expect(row.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })
})
