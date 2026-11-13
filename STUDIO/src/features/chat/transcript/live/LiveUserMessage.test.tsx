/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LiveUserMessage } from '@/features/chat/transcript/live/LiveUserMessage'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { MediaViewerHostContext } from '@/features/artifacts/media/edits'

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('@/platform/harness', async original => ({
  ...await original<object>(),
  attachmentDataUrl: (...args: unknown[]) => mocks.resolve(...args),
}))

/**
 * A sent message's attachments, and the identity they are drawn under.
 *
 * Two pasted screenshots are `image.png` and `image/png` both times, which is
 * an ordinary thing to do and used to collide: the row was keyed on those two
 * facts, React warned about duplicate keys, and one of the pair was free to be
 * dropped or duplicated. Position is the identity here - a sent message's
 * attachment list arrives once with the message and never reorders, grows or
 * shrinks.
 */

function message(
  attachments: Extract<TranscriptItem, { kind: 'user' }>['attachments'],
): Extract<TranscriptItem, { kind: 'user' }> {
  return {
    kind: 'user',
    id: 'msg_1',
    submissionId: 'sub_1',
    text: 'look at these',
    attachments,
    documents: [],
    timestamp: null,
  }
}

const SCREENSHOT = { mediaType: 'image/png', filename: 'image.png', size: 1_024 }

let warnings: string[]

beforeEach(() => {
  mocks.resolve.mockReset().mockResolvedValue('data:image/png;base64,AAAA')
  warnings = []
  // jsdom has no ResizeObserver; the collapsible body measures its own height.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  // React reports a duplicate key through console.error and renders anyway,
  // so the defect is invisible to an assertion about the output alone.
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map((entry) => String(entry)).join(' '))
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a message carrying attachments', () => {
  it('shows a clickable picture above the text bubble and opens the original in the viewer', async () => {
    const open = vi.fn()
    const { container } = render(<MediaViewerHostContext.Provider value={{ open }}>
      <LiveUserMessage conversationId="cnv_pictures" item={message([{ ...SCREENSHOT, id: 'att_original' }])} />
    </MediaViewerHostContext.Provider>)
    const image = await screen.findByRole('img', { name: 'image.png' })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('cnv_pictures', { id: 'att_original', mimeType: 'image/png' })
    const bubble = container.querySelector('.bg-user-bubble')
    expect(bubble?.contains(image)).toBe(false)
    expect(bubble && (image.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preview image.png' }))
    expect(open).toHaveBeenCalledWith({ output: { url: 'data:image/png;base64,AAAA', mimeType: 'image/png', ratio: null }, title: 'image.png', video: false })
  })

  it('preserves two uploaded pictures with the same name as distinct previews', async () => {
    mocks.resolve.mockResolvedValueOnce('data:image/png;base64,AAAA').mockResolvedValueOnce('data:image/png;base64,BBBB')
    render(<LiveUserMessage conversationId="cnv_pair" item={message([
      { ...SCREENSHOT, id: 'att_one' }, { ...SCREENSHOT, id: 'att_two' },
    ])} />)
    const images = await screen.findAllByRole('img', { name: 'image.png' })
    expect(images.map(image => image.getAttribute('src'))).toEqual(['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'])
    expect(warnings.filter(line => line.includes('same key'))).toEqual([])
  })

  it('shows an image-only message without an empty text bubble', async () => {
    const { container } = render(<LiveUserMessage conversationId="cnv_only_image" item={{ ...message([{ ...SCREENSHOT, id: 'att_only' }]), text: '' }} />)
    await screen.findByRole('img', { name: 'image.png' })
    expect(container.querySelector('.bg-user-bubble')).toBeNull()
  })

  it('never carries an image from one conversation into another while bytes load', async () => {
    mocks.resolve.mockResolvedValueOnce('data:image/png;base64,AAAA')
      .mockImplementationOnce(() => new Promise<string | null>(() => {}))
    const item = message([{ ...SCREENSHOT, id: 'att_shared_name' }])
    const view = render(<LiveUserMessage conversationId="cnv_first" item={item} />)
    await screen.findByRole('img', { name: 'image.png' })
    view.rerender(<LiveUserMessage conversationId="cnv_second" item={item} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(mocks.resolve).toHaveBeenLastCalledWith('cnv_second', { id: 'att_shared_name', mimeType: 'image/png' })
  })

  it('shows admitted inline pixels immediately, without making a byte request', () => {
    render(<LiveUserMessage item={message([{ ...SCREENSHOT, url: 'data:image/png;base64,AAAA' }])} />)
    expect(screen.getByRole('img', { name: 'image.png' }).getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it('keeps a clear unavailable state when the stored image cannot be read', async () => {
    mocks.resolve.mockResolvedValue(null)
    render(<LiveUserMessage conversationId="cnv_missing_image" item={message([{ ...SCREENSHOT, id: 'att_missing' }])} />)
    await screen.findByLabelText('Image preview unavailable: image.png')
    expect(screen.getByRole('button', { name: 'Preview image.png' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('replaces an undecodable image with the unavailable state', async () => {
    render(<LiveUserMessage conversationId="cnv_corrupt_image" item={message([{ ...SCREENSHOT, id: 'att_corrupt' }])} />)
    fireEvent.error(await screen.findByRole('img', { name: 'image.png' }))
    expect(screen.getByLabelText('Image preview unavailable: image.png')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Preview image.png' }).hasAttribute('disabled')).toBe(true)
  })

  it('does not load an arbitrary remote image URL from attachment metadata', () => {
    const { container } = render(<LiveUserMessage item={message([{ ...SCREENSHOT, url: 'https://example.com/tracker.png' }])} />)
    expect(container.querySelector('img')).toBeNull()
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it('keeps ordinary file chips in the bubble alongside image previews', async () => {
    const { container } = render(<LiveUserMessage conversationId="cnv_mixed" item={message([
      { ...SCREENSHOT, id: 'att_mixed' }, { mediaType: 'text/plain', filename: 'notes.txt', size: 12 },
    ])} />)
    await screen.findByRole('img', { name: 'image.png' })
    expect(container.querySelector('.bg-user-bubble')?.textContent).toContain('notes.txt')
  })
  it('renders the structure of pasted Markdown inside the user bubble', () => {
    const { container } = render(<LiveUserMessage item={{ ...message([]),
      text: '# Research brief\n\nKeep **important** details and *emphasis*.\n\n1. First\n2. Second\n\n`workspace/chart.png`',
    }} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Research brief' })).toBeTruthy()
    expect(container.querySelector('strong')?.textContent).toBe('important')
    expect(container.querySelector('em')?.textContent).toBe('emphasis')
    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
    expect(container.querySelector('code')?.textContent).toBe('workspace/chart.png')
    expect(container.querySelector('.studio-user-prose')).not.toBeNull()
  })

  it('does not interpret pasted HTML as application markup', () => {
    const { container } = render(<LiveUserMessage item={{ ...message([]),
      text: 'Hello <img src="https://example.com/track.png" onerror="alert(1)"> <script>alert(1)</script>',
    }} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('gives file references a readable treatment while preserving literal text', () => {
    const { container } = render(<LiveUserMessage item={{ ...message([]),
      text: 'Use `workspace/chart.png`, `C:\\My Project\\chart.png`, and `npm i`.',
    }} />)
    const files = [...container.querySelectorAll('code.studio-file-reference')]
    expect(files.map((file) => file.textContent)).toEqual(['workspace/chart.png', 'C:\\My Project\\chart.png'])
    expect([...container.querySelectorAll('code')].find((code) => code.textContent === 'npm i')?.className).not.toContain('studio-file-reference')
  })

  it('draws two files that share a name and a type as two rows', () => {
    render(<LiveUserMessage item={message([SCREENSHOT, SCREENSHOT])} />)

    expect(screen.getAllByText('image.png')).toHaveLength(2)
    expect(warnings.filter((line) => line.includes('same key'))).toEqual([])
  })

  it('still names each file it was given', () => {
    render(
      <LiveUserMessage
        item={message([SCREENSHOT, { mediaType: 'image/jpeg', filename: 'holiday.jpg', size: 20 }])}
      />,
    )

    expect(screen.getByText('image.png')).toBeTruthy()
    expect(screen.getByText('holiday.jpg')).toBeTruthy()
  })

  it('falls back to the type for a file that arrived without a name', () => {
    render(<LiveUserMessage item={message([{ ...SCREENSHOT, filename: null }])} />)

    expect(screen.getByText('image/png')).toBeTruthy()
  })
})
