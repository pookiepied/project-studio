/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GALLERY_CONVERSATION_ID } from '@/domain/session/gallery'
import type { Conversation } from '@/domain/session/types'
import type { ConversationPhase } from '@/features/chat/useConversation'
import { VoiceModeProvider } from '@/features/voice'
import { NavigationProvider } from '@/stores/navigation'
import { RailProvider } from '@/stores/rail'
import { WorkspaceProvider, useWorkspace } from '@/stores/workspace'
import { ChatPage } from './ChatPage'

/**
 * The working mark, from the only place that can vouch for it.
 *
 * The sidebar's ActivityMark renders from the workspace store's `running`
 * set, and the set is fed by whichever view witnesses the conversation's
 * phase machine. What is under test here is that wiring -- submitted and
 * streaming mark the conversation, a settlement or a broken read un-marks
 * it, and the gallery is excluded because the demo turn owns its own
 * marking. The phase machine itself is judged in `submitted-turn.test.tsx`;
 * this file holds the transcript hook as a stub and judges only what the
 * page does with what it is told.
 */

interface LiveStub {
  readonly items: readonly unknown[]
  readonly pending: null
  phase: ConversationPhase
  readonly offset: string | null
  readonly resume: () => void
  readonly submit: () => Promise<{ readonly ok: boolean }>
  readonly abort: () => Promise<{ readonly ok: boolean }>
  readonly refused: null
  readonly dismissRefusal: () => void
}

const live = vi.hoisted((): LiveStub => ({
  items: [],
  pending: null,
  phase: { status: 'idle' },
  offset: null,
  resume: () => {},
  submit: () => Promise.resolve({ ok: true }),
  abort: () => Promise.resolve({ ok: true }),
  refused: null,
  dismissRefusal: () => {},
}))

vi.mock('@/features/chat/useConversationTranscript', () => ({
  useConversationTranscript: (): LiveStub => live,
}))

const CONVERSATION: Conversation = {
  id: 'cnv_live',
  title: 'A conversation being watched',
  projectId: null,
  updatedAt: 2_000,
  pinned: false,
  archived: false,
  modelId: null,
  reasoningLevel: null,
  permissionMode: 'manual',
  messages: [],
}

function tree(conversation: Conversation) {
  return (
    <NavigationProvider>
      <WorkspaceProvider>
        <VoiceModeProvider>
          {/* ChatPage reads the rail store since the plan pill arrived, and
              this harness never carried it; the assertions are unchanged. */}
          <RailProvider>
            <ChatPage conversation={conversation} />
            <RunningProbe />
          </RailProvider>
        </VoiceModeProvider>
      </WorkspaceProvider>
    </NavigationProvider>
  )
}

/** Reads the store the sidebar's row would read, so the test sees the same thing. */
function RunningProbe() {
  const { running } = useWorkspace()
  return (
    <ul aria-label="Working conversations">
      {[...running].map((id) => (
        <li key={id}>{id}</li>
      ))}
    </ul>
  )
}

function workingList(): HTMLElement {
  return screen.getByRole('list', { name: 'Working conversations' })
}

// jsdom has no matchMedia; the voice stage and the composer read breakpoints with it.
// jsdom has no ResizeObserver either; the composer field observes its own width.
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
})

afterEach(cleanup)

describe('the working mark mirrors the phase machine into the workspace', () => {
  it('marks a conversation while its turn runs and un-marks it when it settles', async () => {
    const view = render(tree(CONVERSATION))
    expect(workingList().textContent).toBe('')

    // Admitted, nothing produced yet -- the receipt alone is the claim.
    live.phase = { status: 'submitted', submissionId: 'sub_1' }
    view.rerender(tree(CONVERSATION))
    await waitFor(() => expect(workingList().textContent).toContain('cnv_live'))

    // Producing. Same claim, different phase.
    live.phase = { status: 'streaming', submissionId: 'sub_1', retrying: null }
    view.rerender(tree(CONVERSATION))
    await waitFor(() => expect(workingList().textContent).toContain('cnv_live'))

    // Settled completed.
    live.phase = { status: 'idle' }
    view.rerender(tree(CONVERSATION))
    await waitFor(() => expect(workingList().textContent).toBe(''))

    // A settlement that is not a success un-marks too: failed is still over.
    live.phase = { status: 'submitted', submissionId: 'sub_2' }
    view.rerender(tree(CONVERSATION))
    await waitFor(() => expect(workingList().textContent).toContain('cnv_live'))
    live.phase = {
      status: 'run-failed',
      outcome: 'failed',
      message: 'The turn failed while it was running.',
      detail: null,
    }
    view.rerender(tree(CONVERSATION))
    await waitFor(() => expect(workingList().textContent).toBe(''))
  })

  it('un-marks on a broken read, because a mark with no witness is invented', async () => {
    const view = render(tree(CONVERSATION))
    live.phase = { status: 'streaming', submissionId: null, retrying: null }
    view.rerender(tree(CONVERSATION))
    await waitFor(() => expect(workingList().textContent).toContain('cnv_live'))

    live.phase = { status: 'interrupted', reason: 'The connection went quiet.' }
    view.rerender(tree(CONVERSATION))
    await waitFor(() => expect(workingList().textContent).toBe(''))
  })

  it('never marks the gallery, whose demo turn owns its own marking', async () => {
    const view = render(
      tree({ ...CONVERSATION, id: GALLERY_CONVERSATION_ID, title: 'Everything Studio can show' }),
    )
    live.phase = { status: 'streaming', submissionId: 'sub_demo', retrying: null }
    view.rerender(
      tree({ ...CONVERSATION, id: GALLERY_CONVERSATION_ID, title: 'Everything Studio can show' }),
    )
    // A frame for the effect to have run; the list stays empty throughout.
    await waitFor(() => expect(workingList().textContent).toBe(''))
  })
})
