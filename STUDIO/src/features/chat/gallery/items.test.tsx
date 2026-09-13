/**
 * @vitest-environment jsdom
 */
import { createRef } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NavigationProvider } from '@/stores/navigation'
import { RailProvider } from '@/stores/rail'
import { WorkspaceProvider } from '@/stores/workspace'
import { galleryItems } from './items'
import { LiveTranscript } from '@/features/chat/transcript/live/LiveTranscript'

/**
 * The artifact gallery draws through the live transcript.
 *
 * It used to have a renderer of its own, which meant what it showed was
 * proof about a second stack and not about the components a real reply
 * lands in. What is held here is that the gallery is ordinary items -- a
 * settled user turn, a settled reply with its reasoning -- and that the live
 * list draws them without a harness behind it.
 */

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
}))

afterEach(cleanup)

describe('the gallery as transcript items', () => {
  it('is one settled exchange, with the reasoning in front of the reply', () => {
    const items = galleryItems()
    expect(items.map((item) => item.kind)).toEqual(['user', 'assistant'])
    const reply = items[1]
    if (reply?.kind !== 'assistant') throw new Error('unreachable')
    expect(reply.end).toEqual({ state: 'complete' })
    expect(reply.segments.map((segment) => segment.kind)).toEqual(['thinking', 'text'])
    // Nothing here was observed arriving, so no span is claimed.
    const thinking = reply.segments[0]
    if (thinking?.kind !== 'thinking') throw new Error('unreachable')
    expect(thinking.startedAt).toBeNull()
  })

  it('draws through the live list, idle, with nothing pending', () => {
    // The artifact cards reach for the rail, which is the proof this test is
    // after: the gallery lands in the real renderers, not a stand-in.
    render(
      <NavigationProvider>
        <WorkspaceProvider>
          <RailProvider>
            <LiveTranscript
              items={galleryItems()}
              pending={null}
              phase={{ status: 'idle' }}
              viewport={createRef<HTMLElement>()}
              conversationId="cnv_gallery"
            />
          </RailProvider>
        </WorkspaceProvider>
      </NavigationProvider>,
    )
    expect(screen.getByText(/Show me every kind of artifact/)).toBeTruthy()
    // One of each artifact kind the scene carries, drawn by its own card.
    expect(screen.getByText('Frameless window corners on Windows 11')).toBeTruthy()
    expect(screen.getByText(/Composer reshapes on paste/)).toBeTruthy()
    // The reply is finished: no caret, no "stopped before finishing".
    expect(screen.queryByText(/Stopped before finishing/)).toBeNull()
  })
})
