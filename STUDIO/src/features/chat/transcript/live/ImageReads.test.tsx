/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { present } from '@/platform/harness/contracts/chunks'
import { setAttachmentBytesTransport } from '@/platform/harness/attachments'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { ToolGroups } from './ToolGroups'
import { ImageReads, readImages } from './ImageReads'

afterEach(() => {
  cleanup()
  setAttachmentBytesTransport(null)
})

function read(id: string, data = 'aGVsbG8='): ToolCallView {
  return { toolCallId: id, toolName: 'read', errorText: null,
    input: present({ path: `${id}.png` }),
    output: present({ content: [{ type: 'image', data, mimeType: 'image/png' }] }) }
}

describe('image read previews', () => {
  it('groups adjacent reads without moving images across a text read', () => {
    const calls = [read('one'), read('two'), read('three'),
      { ...read('text'), output: present('plain text') }, read('four')]
    render(<ToolGroups conversationId="conv" groups={calls.map((call) => ({ id: call.toolCallId, file: null, calls: [call] }))} />)
    expect(screen.getByRole('button', { name: /Viewed 3 images/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Viewed 1 image/ })).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Viewed 3 images/ }))
    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(screen.queryByAltText('four.png')).toBeNull()
  })

  it('resolves persisted attachment bytes only after expansion, using the conversation route', async () => {
    const transport = vi.fn(async () => new Uint8Array([104, 105]).buffer)
    setAttachmentBytesTransport(transport)
    render(<ImageReads conversationId="image-read-history" live={false}
      images={readImages(read('persisted', 'att_read_history_0'))} />)
    expect(transport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Viewed 1 image/ }))
    await waitFor(() => expect(screen.getByAltText('persisted.png').getAttribute('src')).toBe('data:image/png;base64,aGk='))
    expect(transport).toHaveBeenCalledWith('/agents/studio/image-read-history/attachments/att_read_history_0')
    fireEvent.click(screen.getByRole('button', { name: 'Preview persisted.png' }))
    expect(screen.getByRole('dialog', { name: 'persisted.png' })).toBeTruthy()
    expect(transport).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows an honest unavailable state when attachment delivery fails', async () => {
    const transport = vi.fn(async () => { throw new Error('unavailable') })
    setAttachmentBytesTransport(transport)
    render(<ImageReads conversationId="image-read-missing" live={false}
      images={readImages(read('missing', 'att_read_missing_0'))} />)
    fireEvent.click(screen.getByRole('button', { name: /Viewed 1 image/ }))
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Image preview unavailable: missing.png')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preview missing.png' })).toBeNull()
  })

  it('replaces an undecodable image with its unavailable message', () => {
    render(<ImageReads conversationId="image-read-invalid" live={false} images={readImages(read('invalid'))} />)
    fireEvent.click(screen.getByRole('button', { name: /Viewed 1 image/ }))
    fireEvent.error(screen.getByAltText('invalid.png'))
    expect(screen.getByText('Image preview unavailable: invalid.png')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('counts every returned image and ignores text, unsafe formats, refusals, and pending reads', () => {
    const call = read('many')
    expect(readImages({ ...call, output: present([
      { type: 'text', text: 'attached' },
      { type: 'image', mimeType: 'image/jpeg', data: 'AAAA' },
      { type: 'image', mimeType: 'image/webp', data: 'att_many_1' },
      { type: 'image', mimeType: 'image/svg+xml', data: 'AAAA' },
      { type: 'image', mimeType: 'image/png', data: '' },
    ]) })).toMatchObject([
      { id: 'many-1', frame: { kind: 'inline' } },
      { id: 'many-2', frame: { kind: 'attachment', id: 'att_many_1' } },
    ])
    expect(readImages({ ...call, errorText: 'failed' })).toEqual([])
    expect(readImages({ ...call, output: null })).toEqual([])
    expect(readImages({ ...call, output: present({ isError: true, content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] }) })).toEqual([])
    expect(readImages({ ...call, output: present('Cannot show image') })).toEqual([])
    expect(readImages({ ...call, toolName: 'write' })).toEqual([])
  })
})
