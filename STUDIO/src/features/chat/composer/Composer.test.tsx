/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VoiceModeProvider } from '@/features/voice'
import { Composer } from './Composer'
import type { TurnImageWire } from '@/platform/harness'

// The composer reads the workspace store for the demo transport's status and
// send; a stub keeps this test about the live receipt mechanics alone. The
// permission control beside the field needs one real mode id to render.
vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({
    status: 'idle',
    send: vi.fn(() => 'demo-conversation'),
    stop: vi.fn(),
    settings: { permission: 'manual' },
    setSettings: vi.fn(),
  }),
}))

type Receipt = { readonly ok: boolean }

afterEach(() => {
  cleanup()
})

// jsdom has no ResizeObserver; the field measures itself with one.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

function renderComposer(
  onSend: (text: string, images: readonly TurnImageWire[]) => Promise<Receipt>,
  busy?: boolean,
) {
  return render(
    <VoiceModeProvider>
      <Composer
        conversationId="cnv_1"
        placeholder="Reply"
        onSend={onSend}
        {...(busy === undefined ? {} : { busy })}
      />
    </VoiceModeProvider>,
  )
}

function type(text: string): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
}

const field = (): string => {
  const box = screen.getByRole('textbox')
  if (!(box instanceof HTMLTextAreaElement)) throw new Error('the field is not a textarea')
  return box.value
}

describe('the field holds its words until the harness takes them', () => {
  it('keeps the typed text when the harness refuses the send', async () => {
    // The Part C failure: an optimistic clear turned a refused POST into a
    // silent swallow. The refusal is answered somewhere visible; the words
    // must still be here to send again.
    const onSend = vi.fn(async () => ({ ok: false }))
    renderComposer(onSend)

    type('please answer this')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('please answer this', []))
    expect(field()).toBe('please answer this')
  })

  it('clears only once the receipt says the harness took the message', async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    type('hello')
    expect(field()).toBe('hello')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(field()).toBe(''))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('is busy from send to receipt, so one message cannot be POSTed twice', async () => {
    // Held in a property, not a bare `let`: the assignment happens inside the
    // promise executor's callback, and control-flow narrowing would call the
    // variable `never` here — the same pattern useConversation.test.tsx uses.
    const holder: { settle: ((receipt: Receipt) => void) | null } = { settle: null }
    const onSend = vi.fn(
      () =>
        new Promise<Receipt>((resolve) => {
          holder.settle = resolve
        }),
    )
    renderComposer(onSend)

    type('one copy only')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onSend).toHaveBeenCalled())

    // Still in flight: the control reads Stop, and clicking it cannot start
    // a second POST — a duplicate turn is the one thing a retry here would
    // manufacture.
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onSend).toHaveBeenCalledTimes(1)

    if (holder.settle === null) throw new Error('unreachable')
    holder.settle({ ok: true })
    await waitFor(() => expect(field()).toBe(''))
  })
  it('stays busy from send to receipt even when the page passes a busy of its own', () => {
    // ChatPage passes `busy={phase.status === 'streaming'}` — a BOOLEAN, and
    // `false` for the whole POST round trip, because the turn has not started
    // streaming yet. A guard written as `busyOverride ?? sending` never
    // reaches `sending` when the caller always supplies a boolean, so the
    // in-flight lock existed only in tests that omitted the prop. Two clicks
    // then mean two POSTs, and an identical resend is a SECOND TURN by
    // design — the harness pins that and deduplicates nothing.
    const holder: { settle: ((receipt: Receipt) => void) | null } = { settle: null }
    const onSend = vi.fn(
      () =>
        new Promise<Receipt>((resolve) => {
          holder.settle = resolve
        }),
    )
    renderComposer(onSend, false)

    type('one copy only')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledTimes(1)

    // The field still holds the words, so a second click is a live path.
    fireEvent.click(screen.getByRole('button', { name: /Send|Stop/ }))
    expect(onSend).toHaveBeenCalledTimes(1)
  })
})

describe('the images a turn carries', () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

  /** Opens the plus menu's Image item, which wakes the hidden file input. */
  function pickImages(): void {
    fireEvent.click(screen.getByRole('button', { name: 'Add context' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Image/ }))
  }

  function pickerInput(): HTMLInputElement {
    const input = document.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('no picker in the composer')
    return input
  }

  function changeFiles(input: HTMLInputElement, files: File[]): void {
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    fireEvent.change(input)
  }

  it('carries a picked image with the words, and strips it once the receipt lands', async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    pickImages()
    changeFiles(pickerInput(), [
      new File([pngBytes], 'photo.png', { type: 'image/png' }),
      new File([new Uint8Array([0, 1, 2])], 'notes.txt', { type: 'text/plain' }),
    ])

    await waitFor(() => expect(screen.getByAltText('photo.png')).toBeTruthy())
    // The picker's honest remainder: a file the rules refused, named.
    expect(screen.getByText(/notes\.txt — Images only/)).toBeTruthy()

    type('look at this')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith('look at this', [
        {
          type: 'image',
          data: btoa(String.fromCharCode(...pngBytes)),
          mimeType: 'image/png',
          filename: 'photo.png',
        },
      ]),
    )
    await waitFor(() => expect(screen.queryByAltText('photo.png')).toBeNull())
    expect(screen.queryByText(/notes\.txt/)).toBeNull()
  })

  it('keeps the strip when the harness refuses, exactly as it keeps the words', async () => {
    const onSend = vi.fn(async () => ({ ok: false }))
    renderComposer(onSend)

    pickImages()
    changeFiles(pickerInput(), [new File([pngBytes], 'photo.png', { type: 'image/png' })])
    await waitFor(() => expect(screen.getByAltText('photo.png')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onSend).toHaveBeenCalled())
    expect(screen.getByAltText('photo.png')).toBeTruthy()
    expect(field()).toBe('')
  })
})
