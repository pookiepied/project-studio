/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VoiceModeProvider } from '@/features/voice'
import { Composer } from './Composer'
import type { TurnImageWire } from '@/platform/harness'

// The permission control beside the field reads the workspace store, and
// needs one real mode id to render; a stub keeps this test about the receipt
// mechanics alone.
vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({
    settings: { permission: 'ask' },
    setSettings: vi.fn(),
    // The permission control now reads the conversation's stored mode; this
    // test runs on a surface with no conversations, so the window setting is
    // the whole story and the setter is never called.
    conversations: [],
    setConversationPermission: vi.fn(),
  }),
  // The slash's "/compact" reads the compacting set; nothing here compacts.
  useLiveWork: () => ({
    compacting: new Set<string>(),
    markCompacting: vi.fn(),
    bumpContext: vi.fn(),
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

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('please answer this', [], []))
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

  /** Opens the plus menu's Files item, which wakes the hidden file input. */
  function pickImages(): void {
    fireEvent.click(screen.getByRole('button', { name: 'Add context' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Files/ }))
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
      new File([new Uint8Array([0, 1, 2])], 'notes.zip', { type: 'application/zip' }),
    ])

    await waitFor(() => expect(screen.getByAltText('photo.png')).toBeTruthy())
    // The picker's honest remainder: a file the rules refused, named.
    expect(screen.getByText(/notes\.zip — Images only/)).toBeTruthy()

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
      ], []),
    )
    await waitFor(() => expect(screen.queryByAltText('photo.png')).toBeNull())
    expect(screen.queryByText(/notes\.zip/)).toBeNull()
  })

  it('carries a picked document as the file it is, beside the words, and strips it once taken', async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    pickImages()
    const report = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'report.pdf', { type: 'application/pdf' })
    changeFiles(pickerInput(), [report])

    // A chip, not a thumbnail: the name and the size are what a person checks.
    await waitFor(() => expect(screen.getByText('report.pdf')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Remove report.pdf' })).toBeTruthy()

    type('summarise this')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('summarise this', [], [report]))
    await waitFor(() => expect(screen.queryByText('report.pdf')).toBeNull())
  })

  it('sends with a document and no words at all', async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    pickImages()
    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    changeFiles(pickerInput(), [notes])
    await waitFor(() => expect(screen.getByText('notes.txt')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('', [], [notes]))
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

/**
 * The clipboard and the drop: a screenshot on the clipboard, or a file
 * dragged onto the field, joins the strip through the same rules the picker
 * uses -- judged, read, refused by name. Text pastes are the field's own
 * job and never become attachments.
 */
describe('paste and drop', () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 6, 7, 8])

  it('turns a pasted screenshot into a pending image', async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    const { container } = renderComposer(onSend)

    const field = screen.getByRole('textbox')
    fireEvent.paste(field, {
      clipboardData: {
        files: [new File([pngBytes], 'pasted.png', { type: 'image/png' })],
      },
    })

    await waitFor(() => expect(screen.getByAltText('pasted.png')).toBeTruthy())
    // The words are untouched: nothing was inserted into the field.
    expect(container.querySelector('textarea')?.value).toBe('')
  })

  it('lands a dropped image in the strip, and names a refused file', async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    const composer = screen.getByRole('textbox').closest('div')?.parentElement
    if (composer === null || composer === undefined) throw new Error('no composer frame')
    fireEvent.dragOver(composer)
    fireEvent.drop(composer, {
      dataTransfer: {
        files: [
          new File([pngBytes], 'dropped.png', { type: 'image/png' }),
          new File([new Uint8Array([9])], 'table.bin', { type: 'application/octet-stream' }),
        ],
      },
    })

    await waitFor(() => expect(screen.getByAltText('dropped.png')).toBeTruthy())
    expect(screen.getByText(/table\.bin — Images only/)).toBeTruthy()
  })

  it('leaves a text-only paste to the field', () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: { files: [] },
    })
    expect(screen.queryByRole('img')).toBeNull()
  })
})

/**
 * The insecure-origin half of the parity table: microphone access is a
 * secure-context capability, so on plain HTTP the voice controls answer as
 * disabled - present in their places, greyed, with the reason as their
 * label - instead of vanishing and taking the row's shape with them.
 */
describe('voice on an insecure origin', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'isSecureContext')
  })

  it('keeps the voice controls in place and disabled, with the reason as their label', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    // Both voice controls answer as disabled, and the reason is each one's
    // label - the dictate control and voice mode carry the same sentence
    // because they refuse for the same reason.
    const disabled = screen.getAllByRole('button', {
      name: 'Voice input needs a secure connection to Studio.',
    })
    expect(disabled).toHaveLength(2)
    for (const control of disabled) expect(control.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Voice mode' })).toBeNull()
    // The line that used to stand where these buttons are is gone; the
    // field's cluster is icons again.
    expect(screen.queryByRole('note')).toBeNull()
    // Everything else still answers: the field and its send control are not
    // part of the degradation.
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add context' })).toBeTruthy()
  })

  it('keeps the voice controls enabled on a secure origin', () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    expect(screen.getByRole('button', { name: 'Dictate' })).toBeTruthy()
    const voice = screen.getByRole('button', { name: 'Voice mode' })
    expect(voice.hasAttribute('disabled')).toBe(false)
  })
})
