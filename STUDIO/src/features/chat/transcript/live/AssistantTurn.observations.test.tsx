/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientObservations } from '@/platform/diagnostics/events'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { AssistantTurn } from './AssistantTurn'

vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
// jsdom's window frame clock and Node's performance clock have different origins.
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16))
vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
afterEach(() => { cleanup(); clientObservations.configure(null) })

describe('assistant text display observations', () => {
  it('joins first and settled DOM text commits without recording the displayed body', async () => {
    clientObservations.configure('fixture-capture')
    const item: Extract<TranscriptItem, { kind: 'assistant' }> = {
      kind: 'assistant', id: 'message', submissionId: 'submission', model: null, usage: null,
      segments: [{ kind: 'text', id: 'block', text: 'Private answer' }], end: { state: 'stopped' },
    }
    const view = render(<AssistantTurn item={item} live conversationId="conversation" />)
    await waitFor(() => expect(screen.getByText('Private answer')).not.toBeNull())
    const first = clientObservations.take()?.events.filter((event) => event.name === 'client.display') ?? []
    expect(first.map((event) => event.attributes.stage)).toEqual(['first_dom_commit'])
    expect(first[0]?.identity).toEqual({ conversationId: 'conversation', submissionId: 'submission', messageId: 'message', blockId: 'block' })
    expect(first[0]?.attributes.streaming).toBe(true)
    view.rerender(<AssistantTurn item={{ ...item, end: { state: 'complete' } }} live={false} conversationId="conversation" />)
    const settled = clientObservations.take()?.events.filter((event) => event.name === 'client.display') ?? []
    expect(settled.map((event) => event.attributes.stage)).toEqual(['settled_dom_commit'])
    expect(settled[0]?.attributes.characters).toBe('Private answer'.length)
    expect(settled[0]?.identity).toEqual(first[0]?.identity)
    expect(JSON.stringify([...first, ...settled])).not.toContain('Private answer')
    view.rerender(<AssistantTurn item={{ ...item, end: { state: 'complete' } }} live={false} conversationId="conversation" />)
    expect(clientObservations.take()).toBeNull()
  })
})
