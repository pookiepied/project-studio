/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VOICE_UNAVAILABLE_REASON, VoiceModeProvider } from '@/features/voice'
import { Composer } from './Composer'
import type { TurnImageWire } from '@/platform/harness'

// The permission control beside the field reads the workspace store, and
// needs one real mode id to render; a stub keeps this test about the receipt
// mechanics alone.
const liveWork = vi.hoisted(() => ({
  markCompacting: vi.fn(),
  bumpContext: vi.fn(),
}))
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
  // The slash's "/compact" reads and marks the compacting set; the fns are
  // held so a test can watch the mark being made — it is what turns the
  // transcript's compaction row on.
  useLiveWork: () => ({
    compacting: new Set<string>(),
    markCompacting: liveWork.markCompacting,
    bumpContext: liveWork.bumpContext,
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

// jsdom has no scrollIntoView either; the picker keeps its picked row in
// view with one. A thrown one of these unmounts the whole tree under React
// 19, which is why the composer renders empty without it.
Element.prototype.scrollIntoView = () => undefined

function renderComposer(
  onSend: (text: string, images: readonly TurnImageWire[]) => Promise<Receipt>,
  busy?: boolean,
  controls?: { onQueue?: typeof onSend; onStop?: () => void; queueFull?: boolean; restoredMessage?: { submissionId: string; text: string; images: readonly TurnImageWire[] } },
) {
  return render(
    <VoiceModeProvider>
      <Composer
        conversationId="cnv_1"
        placeholder="Reply"
        onSend={onSend}
        {...(busy === undefined ? {} : { busy })}
        {...controls}
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
  it('holds a draft when the queue is full so an existing message can be steered first', () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    const onQueue = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend, true, { onQueue, queueFull: true })
    type('keep this draft')
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onQueue).not.toHaveBeenCalled()
    expect(field()).toBe('keep this draft')
    expect(screen.getByRole('button', { name: 'Queue message' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Steer' })).toBeNull()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('restores an edited queued message and sends the revised words through the queue', async () => {
    const onQueue = vi.fn(async () => ({ ok: true }))
    renderComposer(vi.fn(async () => ({ ok: true })), true, { onQueue, restoredMessage: { submissionId: 'sub_edit', text: 'old queued words', images: [] } })
    expect(field()).toContain('old queued words')
    type('revised queued words')
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await waitFor(() => expect(onQueue).toHaveBeenCalledWith('revised queued words', [], []))
    await waitFor(() => expect(field()).toBe(''))
  })
  it('queues on Enter and send without expanding the running controls', async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    const onQueue = vi.fn(async () => ({ ok: true }))
    const onStop = vi.fn()
    renderComposer(onSend, true, { onQueue, onStop })
    const stop = screen.getByRole('button', { name: 'Stop' })
    expect(screen.queryByRole('button', { name: 'Queue message' })).toBeNull()
    const buttons = screen.getAllByRole('button').length
    type('next task')
    const send = screen.getByRole('button', { name: 'Queue message' })
    expect(send).toBe(stop)
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(buttons)
    expect(send.textContent).not.toContain('Queue')
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await waitFor(() => expect(field()).toBe(''))
    expect(onQueue).toHaveBeenCalledWith('next task', [], [])
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBe(stop)
    expect(screen.getAllByRole('button')).toHaveLength(buttons)
    type('another follow-up')
    fireEvent.click(screen.getByRole('button', { name: 'Queue message' }))
    await waitFor(() => expect(field()).toBe(''))
    expect(onQueue).toHaveBeenLastCalledWith('another follow-up', [], [])
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('keeps a refused queued message in the composer', async () => {
    const onQueue = vi.fn(async () => ({ ok: false }))
    renderComposer(vi.fn(async () => ({ ok: true })), true, { onQueue })
    type('keep this correction')
    fireEvent.click(screen.getByRole('button', { name: 'Queue message' }))
    await waitFor(() => expect(onQueue).toHaveBeenCalledTimes(1))
    expect(field()).toBe('keep this correction')
  })
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

  it('rejects identical image bytes in a batch and on a later pick, including renamed copies', async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)
    type('check this file')
    pickImages()
    changeFiles(pickerInput(), [
      new File([pngBytes], 'first.png', { type: 'image/png' }),
      new File([pngBytes], 'renamed.png', { type: 'image/png' }),
    ])
    await waitFor(() => expect(screen.getByText(/renamed.png \u2014 Already attached to this message/)).toBeTruthy())
    expect(screen.getAllByRole('img')).toHaveLength(1)
    changeFiles(pickerInput(), [new File([pngBytes], 'again.png', { type: 'image/png' })])
    await waitFor(() => expect(screen.getByText(/again.png \u2014 Already attached to this message/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onSend).toHaveBeenCalled())
    expect(onSend).toHaveBeenCalledWith('check this file', [expect.objectContaining({ filename: 'first.png' })], [])
  })

  it('rejects duplicate documents but retains different contents with the same name', async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)
    type('')
    pickImages()
    const original = new File(['abc'], 'same.txt')
    const different = new File(['xyz'], 'same.txt')
    changeFiles(pickerInput(), [original, new File(['abc'], 'copy.txt'), different])
    await waitFor(() => expect(screen.getByText(/copy.txt \u2014 Already attached to this message/)).toBeTruthy())
    expect(screen.getAllByRole('button', { name: 'Remove same.txt' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('', [], [original, different]))
  })

  it('waits for pending duplicate checks before sending, so a late copy cannot land in the next draft', async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)
    type('read this')
    pickImages()
    const original = new File(['abc'], 'original.txt')
    changeFiles(pickerInput(), [original])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove original.txt' })).toBeTruthy())
    let finish: (bytes: ArrayBuffer) => void = () => { throw new Error('no pending file read') }
    const copy = new File(['abc'], 'copy.txt')
    const read = vi.spyOn(copy, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>((resolve) => { finish = resolve }))
    changeFiles(pickerInput(), [copy])
    await waitFor(() => expect(read).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    finish(new Uint8Array([97, 98, 99]).buffer)
    await waitFor(() => expect(screen.getByText(/copy.txt \u2014 Already attached/)).toBeTruthy())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('read this', [], [original]))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove original.txt' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Remove copy.txt' })).toBeNull()
  })

  it('allows an image again after removing it or sending the draft', async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)
    pickImages()
    const photo = new File([pngBytes], 'photo.png', { type: 'image/png' })
    changeFiles(pickerInput(), [photo])
    await waitFor(() => expect(screen.getByAltText('photo.png')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo.png' }))
    changeFiles(pickerInput(), [photo])
    await waitFor(() => expect(screen.getByAltText('photo.png')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.queryByAltText('photo.png')).toBeNull())
    changeFiles(pickerInput(), [photo])
    await waitFor(() => expect(screen.getByAltText('photo.png')).toBeTruthy())
    expect(screen.queryByText(/Already attached/)).toBeNull()
  })

  it('does not let a duplicate use a slot in a mixed selection at the image limit', async () => {
    renderComposer(vi.fn(async () => ({ ok: true })))
    pickImages()
    const pictures = Array.from({ length: 5 }, (_, index) =>
      new File([pngBytes, new Uint8Array([index])], `${index}.png`, { type: 'image/png' }))
    const first = pictures[0]
    if (first === undefined) throw new Error('no first image')
    changeFiles(pickerInput(), [first, first, ...pictures.slice(1)])
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(5))
    expect(screen.getByText(/0.png \u2014 Already attached/)).toBeTruthy()
    expect(screen.queryByText(/at most/)).toBeNull()
    changeFiles(pickerInput(), [first])
    await waitFor(() => expect(screen.getByText(/0.png \u2014 Already attached/)).toBeTruthy())
    expect(screen.queryByText(/at most/)).toBeNull()
  })

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

  it('stages a mixed multi-file drop, including images without MIME, and sends every accepted attachment', async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    const view = renderComposer(onSend)
    const composer = view.container.querySelector('[data-composer-frame]')
    if (!(composer instanceof HTMLElement)) throw new Error('No composer')
    const other = new Uint8Array(pngBytes)
    other[other.length - 1] = 42
    const paper = new File(['Document context'], 'notes.txt', { type: 'text/plain' })
    fireEvent.drop(composer, { dataTransfer: { types: ['Files'], files: [
      new File([pngBytes], 'one.png', { type: 'image/png' }), new File([other], 'two.PNG'), paper,
    ] } })
    await waitFor(() => expect(screen.getByAltText('one.png')).toBeTruthy())
    await waitFor(() => expect(screen.getByAltText('two.PNG')).toBeTruthy())
    expect(screen.getByText('notes.txt')).toBeTruthy()
    expect(onSend).not.toHaveBeenCalled()
    type('Use these as context')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Use these as context', [
      expect.objectContaining({ filename: 'one.png', mimeType: 'image/png' }),
      expect.objectContaining({ filename: 'two.PNG', mimeType: 'image/png' }),
    ], [paper]))
  })

  it('rejects a rapid duplicate arriving through paste and drop while the first file is reading', async () => {
    renderComposer(vi.fn(async () => ({ ok: true })))
    const textbox = screen.getByRole('textbox')
    const composer = document.querySelector('[data-composer-frame]')
    if (composer === null) throw new Error('no composer')
    fireEvent.paste(textbox, { clipboardData: { files: [new File([pngBytes], 'pasted.png', { type: 'image/png' })] } })
    fireEvent.drop(composer, { dataTransfer: { files: [new File([pngBytes], 'dropped.png', { type: 'image/png' })], types: ['Files'] } })
    await waitFor(() => expect(screen.getByText(/dropped.png \u2014 Already attached/)).toBeTruthy())
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

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
      name: VOICE_UNAVAILABLE_REASON,
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

  it('shows the reason when a disabled voice control is tapped, since a phone has no hover', async () => {
    vi.useFakeTimers()
    try {
      Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
      renderComposer(vi.fn(async () => ({ ok: true })))

      const [dictate] = screen.getAllByRole('button', { name: VOICE_UNAVAILABLE_REASON })
      // The tooltip's trigger wraps the control: a disabled button takes no
      // pointer events of its own.
      const trigger = dictate?.parentElement
      if (!trigger) throw new Error('the dictate control has no tooltip trigger')
      fireEvent.pointerDown(trigger, { pointerType: 'touch' })
      fireEvent.pointerLeave(trigger, { pointerType: 'touch' })
      expect(screen.getByRole('tooltip').textContent).toBe(VOICE_UNAVAILABLE_REASON)

      // It goes on its own; nothing else on a phone would close it.
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      vi.useRealTimers()
      // Its exit animation runs on real frames.
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
    } finally {
      vi.useRealTimers()
    }
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

/**
 * The slash, end to end but for the socket. Nothing here mocks a module of
 * ours: the address resolves through the same env vars the production read
 * uses, the harness's own answer is served by a stubbed `fetch`, and
 * everything between — the client, the requester, the contract, the picker
 * and the send path — is the code the window runs. What is pinned is the
 * experience: a slash offers the commands the moment it is typed, Enter
 * completes the picked name, and what goes out is the harness's expansion,
 * not the words. The listing below is what the harness answers, built-in
 * first, its record carrying the hint as the empty string — which is what
 * took the record, the listing, the picker and the settings pane down
 * together before the contract learned to read it.
 */
describe('the slash, from the field', () => {
  const LISTING = {
    commands: [
      {
        id: 'compact',
        description: 'Compact the conversation: fold the earlier turns into a summary',
        argumentHint: '',
        provenance: 'builtin',
        kind: 'action',
        path: null,
      },
      {
        id: 'explain',
        description: 'Explain a file, a function or a concept in plain words',
        argumentHint: '<what to explain>',
        provenance: 'system',
        kind: 'prompt',
        path: 'C:/studio/commands/explain.md',
      },
      {
        id: 'review',
        description: 'Review the changes on the current branch and report what needs fixing',
        argumentHint: '[focus]',
        provenance: 'system',
        kind: 'prompt',
        path: 'C:/studio/commands/review.md',
      },
    ],
    problems: [],
    userDirectory: 'C:/studio/commands',
  }

  afterEach(() => {
    vi.stubEnv('VITE_HARNESS_BASE_URL', undefined)
    vi.stubEnv('VITE_HARNESS_TOKEN', undefined)
  })

  interface Call {
    readonly url: string
    readonly method: string
    readonly body: string | null
  }

  /** An answer with a JSON body, the way the harness sends its successes. */
  function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Answers what the harness answers on the two routes the slash touches,
   * and records every ask. The pairing probe 404s, as any host that is not
   * Studio's listener would. A listing status other than 200 is how the
   * tests below make the harness useless without making it absent.
   */
  function serveHarness(listingStatus = 200, compactReply?: () => Promise<Response>): Call[] {
    const calls: Call[] = []
    vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:4319')
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-test-credential')
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url =
        input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      })
      if (url.includes('/api/pairing/state')) return new Response(null, { status: 404 })
      if (url.endsWith('/api/commands')) {
        if (listingStatus === 200) return jsonResponse(LISTING)
        return jsonResponse({ error: 'The listing broke.', code: 'extend.internal' }, 500)
      }
      if (/\/api\/commands\/[a-z0-9-]+\/expand$/.test(url)) {
        return jsonResponse({ text: 'Explain the projection layer in plain words, please.' })
      }
      if (url.endsWith('/compact')) return compactReply?.() ?? new Response(null, { status: 200 })
      return new Response(null, { status: 404 })
    }
    vi.stubGlobal('fetch', fetch)
    return calls
  }

  it('offers the commands while the name is typed, completes the picked one, and sends its expansion', async () => {
    const calls = serveHarness()
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    // One slash, the whole list: built-ins first, then the files by name.
    type('/')
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Commands' })).toBeTruthy())
    expect(screen.getAllByRole('option')).toHaveLength(3)

    // The name still being typed narrows the list to the one that matches.
    type('/exp')
    expect(screen.getByRole('option', { name: /explain/ })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /compact/ })).toBeNull()

    // Enter takes the picked row: the name completes, the hint's argument
    // comes next, and the picker steps aside for the words. This command
    // takes an argument, so the second Enter is the send — here the click.
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(field()).toBe('/explain ')
    // The panel now LEAVES rather than being torn out — an exit on the
    // clock — so the going takes a moment and the test waits it out.
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())

    type('/explain the projection layer')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith('Explain the projection layer in plain words, please.', [], []),
    )

    // And the ask that carried it: the picked command's own route, the words
    // after the name sent as its arguments. What comes back is the harness's
    // substitution; what this pins is that we asked with the right words.
    const expand = calls.find((asked) => asked.url.endsWith('/api/commands/explain/expand'))
    if (expand === undefined) throw new Error('the expansion was never asked for')
    expect(expand.method).toBe('POST')
    expect(expand.body).toBe('{"arguments":"the projection layer"}')
  })

  it('offers the commands in a panel above the frame, not inside it', async () => {
    // The picker used to render in the composer's own flow: the frame grew
    // upward and the rows sat on the field's raised surface, which read as
    // the commands living inside the text field. The panel is a portal now —
    // a separate surface floating over the transcript — and this pins the
    // seam: no row is a descendant of the composer's frame.
    serveHarness()
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    type('/')
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Commands' })).toBeTruthy())

    const frame = document.querySelector('[data-composer-frame]')
    if (!(frame instanceof HTMLElement)) throw new Error('no composer frame')
    const panel = screen.getByRole('listbox', { name: 'Commands' }).closest('div')
    if (panel === null) throw new Error('no picker panel')
    expect(frame.contains(panel)).toBe(false)
    expect(frame.contains(screen.getByRole('option', { name: /compact/ }))).toBe(false)
    expect(document.body.contains(panel)).toBe(true)
  })

  it('shows what follows the name, and nothing where nothing is expected', async () => {
    serveHarness()
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    type('/')
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Commands' })).toBeTruthy())

    const explain = screen.getByRole('option', { name: /explain/ })
    expect(explain.textContent).toContain('<what to explain>')
    // The built-in takes nothing, so its row carries no hint at all — not
    // even the empty one the record ships.
    const compact = screen.getByRole('option', { name: /compact/ })
    expect(compact.textContent).not.toContain('<what to explain>')
    expect(compact.textContent.startsWith('/compact')).toBe(true)
  })

  it('tells the person a name matched nothing, and sends it as written', async () => {
    const calls = serveHarness()
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    type('/zzz')
    await waitFor(() => expect(calls.some((asked) => asked.url.endsWith('/api/commands'))).toBe(true))
    expect(screen.getByText('No command by that name. Sent as written.')).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()

    // And the promise holds once the arguments begin: the note steps aside,
    // and what goes out is what was typed, slash and all.
    type('/zzz promptly')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('/zzz promptly', [], []))
  })

  it('sends the words as typed when the harness answers but lists nothing', async () => {
    const calls = serveHarness(500)
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    type('/')
    await waitFor(() => expect(calls.some((asked) => asked.url.endsWith('/api/commands'))).toBe(true))
    // No picker, and no note either: without the listing the composer has
    // nothing to say about it. The field still works.
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByText(/No command by that name/)).toBeNull()

    type('/exp plain')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('/exp plain', [], []))
  })

  it('dismisses the picker with Escape and leaves the drafted name, space and all', async () => {
    serveHarness()
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    type('/explain')
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Commands' })).toBeTruthy())
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    // Dismissal is an exit now, not an unmount: the panel plays its leaving.
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    // The draft stays — the name completed by the space its arguments
    // follow — so dismissing is not losing; the words are the next
    // keystrokes.
    expect(field()).toBe('/explain ')
  })

  for (const trigger of ['click', 'enter', 'send'] as const) {
    it(`starts compaction on ${trigger}, clears the command during the request, and keeps a new draft`, async () => {
      let finish: (response: Response) => void = () => { throw new Error('no compaction request') }
      const calls = serveHarness(200, () => new Promise<Response>((resolve) => { finish = resolve }))
      const onSend = vi.fn(async () => ({ ok: true }))
      renderComposer(onSend)
      type(trigger === 'send' ? '/compact' : '/comp')
      await waitFor(() => expect(screen.getByRole('option', { name: /compact/ })).toBeTruthy())
      if (trigger === 'click') fireEvent.mouseDown(screen.getByRole('option', { name: /compact/ }))
      else if (trigger === 'enter') fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
      else fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      await waitFor(() => expect(calls.filter((call) => call.url.endsWith('/compact'))).toHaveLength(1))
      expect(field()).toBe('')
      expect(onSend).not.toHaveBeenCalled()
      type('my next message')
      finish(new Response(null, { status: 200 }))
      await waitFor(() => expect(liveWork.markCompacting).toHaveBeenCalledWith('cnv_1', false))
      expect(field()).toBe('my next message')
      expect(onSend).not.toHaveBeenCalled()
    })
  }

  it('completes an action name with Tab without executing it', async () => {
    const calls = serveHarness()
    renderComposer(vi.fn(async () => ({ ok: true })))
    type('/comp')
    await waitFor(() => expect(screen.getByRole('option', { name: /compact/ })).toBeTruthy())
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' })
    expect(field()).toBe('/compact ')
    expect(calls.some((call) => call.url.endsWith('/compact'))).toBe(false)
  })

  it('recognizes typed /compact before the command listing arrives, even when that listing fails', async () => {
    const calls = serveHarness(500)
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)
    type('/compact')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(field()).toBe('')
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/compact'))).toBe(true))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('runs /compact where it stands: marks the conversation, asks the harness, and sends nothing', async () => {
    // An action command is not a message: nothing goes to the turn endpoint,
    // the field clears, and the mark the transcript's compaction row reads is
    // made around the harness's own ask — true while it runs, cleared when it
    // answers, the context bumped either way so the meter re-reads.
    const calls = serveHarness()
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    type('/compact')
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Commands' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(calls.some((asked) => asked.url.endsWith('/api/conversations/cnv_1/compact'))).toBe(
        true,
      ),
    )
    expect(onSend).not.toHaveBeenCalled()
    await waitFor(() => expect(field()).toBe(''))
    expect(liveWork.markCompacting).toHaveBeenCalledWith('cnv_1', true)
    expect(liveWork.markCompacting).toHaveBeenCalledWith('cnv_1', false)
    expect(liveWork.bumpContext).toHaveBeenCalledWith('cnv_1')
    // The action ran; the composer holds no sentence about a success — the
    // transcript's row is the one place the state is said.
    expect(screen.queryByRole('status')).toBeNull()
  })
})
