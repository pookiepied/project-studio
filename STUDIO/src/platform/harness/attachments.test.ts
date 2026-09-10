import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  attachmentDataUrl,
  isAttachmentReference,
  pictureMime,
  setAttachmentBytesTransport,
  type AttachmentBytes,
} from './attachments'

/**
 * The UI's attachment resolver.
 *
 * Everything a renderer can be told about a frame lives behind these two
 * functions, and the failure mode the whole task exists to end - a reference
 * rendered as though it were base64 - is a straight line from getting one of
 * these answers wrong. The transport is the test seam: the real one is a
 * Tauri command that does not exist in a test process.
 */

afterEach(() => {
  setAttachmentBytesTransport(null)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** A few bytes as an ArrayBuffer, without a cast. */
function bytesOf(text: string): ArrayBuffer {
  const view = new TextEncoder().encode(text)
  const buffer = new ArrayBuffer(view.length)
  new Uint8Array(buffer).set(view)
  return buffer
}

describe('telling a reference from bytes', () => {
  it('names a reference by the prefix the attachment store chose', () => {
    expect(isAttachmentReference('att_msg_1_0')).toBe(true)
  })

  it('never mistakes base64 for a reference', () => {
    // `_` is not a base64 character, which is what makes the prefix
    // unambiguous in the other direction too: real bytes cannot begin `att_`.
    expect(isAttachmentReference('AAAA')).toBe(false)
    expect(isAttachmentReference('')).toBe(false)
    expect(isAttachmentReference('at_1')).toBe(false)
  })
})

describe('resolving one attachment', () => {
  it('fetches the bytes and answers a data URL the img can show', async () => {
    const transport: AttachmentBytes = vi.fn(async (path) => {
      expect(path).toBe('/agents/studio/conv_1/attachments/att_msg_1_0')
      return bytesOf('frame-bytes')
    })
    setAttachmentBytesTransport(transport)

    const url = await attachmentDataUrl('conv_1', { id: 'att_msg_1_0', mimeType: 'image/jpeg' })
    expect(url).toBe(`data:image/jpeg;base64,${btoa('frame-bytes')}`)
  })

  it('answers the cached URL without touching the transport again', async () => {
    const transport: AttachmentBytes = vi.fn(async () => bytesOf('frame-bytes'))
    setAttachmentBytesTransport(transport)

    const first = await attachmentDataUrl('conv_2', { id: 'att_msg_2_0', mimeType: 'image/jpeg' })
    const second = await attachmentDataUrl('conv_2', { id: 'att_msg_2_0', mimeType: 'image/jpeg' })
    expect(second).toBe(first)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('shares one route between concurrent callers', async () => {
    // One transcript can name the same frame in the card, the report and the
    // rail at once; three fetches for three renderers of one reference is the
    // waste the in-flight map exists to end.
    let releases: Array<(bytes: ArrayBuffer) => void> = []
    const transport: AttachmentBytes = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          releases.push(resolve)
        }),
    )
    setAttachmentBytesTransport(transport)

    const first = attachmentDataUrl('conv_3', { id: 'att_msg_3_0', mimeType: 'image/jpeg' })
    const second = attachmentDataUrl('conv_3', { id: 'att_msg_3_0', mimeType: 'image/jpeg' })
    expect(transport).toHaveBeenCalledTimes(1)
    releases[0]?.(bytesOf('shared'))
    expect(await first).toBe(await second)
    releases = []
  })

  it('remembers a refusal, so a missing frame is not re-asked for on every render', async () => {
    // The route is immutable - an attachment the harness cannot produce now
    // will not exist later - so the failure is cached like the success.
    const transport: AttachmentBytes = vi.fn(async () => {
      throw new Error('not found')
    })
    setAttachmentBytesTransport(transport)

    await expect(
      attachmentDataUrl('conv_4', { id: 'att_msg_4_0', mimeType: 'image/jpeg' }),
    ).resolves.toBeNull()
    await expect(
      attachmentDataUrl('conv_4', { id: 'att_msg_4_0', mimeType: 'image/jpeg' }),
    ).resolves.toBeNull()
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('forgets a refusal after a minute, so a harness that comes back is believed', async () => {
    // Not every failure is immutable: a harness still booting or a credential
    // mid-rotation fails the same way a 404 does, and "forever" would freeze
    // one unlucky early render into the session. The memory is bounded.
    vi.useFakeTimers()
    const transport: AttachmentBytes = vi.fn(async () => {
      throw new Error('not running yet')
    })
    setAttachmentBytesTransport(transport)

    await expect(
      attachmentDataUrl('conv_7', { id: 'att_msg_7_0', mimeType: 'image/jpeg' }),
    ).resolves.toBeNull()
    vi.setSystemTime(Date.now() + 61_000)
    await expect(
      attachmentDataUrl('conv_7', { id: 'att_msg_7_0', mimeType: 'image/jpeg' }),
    ).resolves.toBeNull()
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('keys the cache by conversation, because the route does', async () => {
    const transport: AttachmentBytes = vi.fn(async () => bytesOf('frame-bytes'))
    setAttachmentBytesTransport(transport)

    await attachmentDataUrl('conv_5', { id: 'att_msg_5_0', mimeType: 'image/jpeg' })
    await attachmentDataUrl('conv_6', { id: 'att_msg_5_0', mimeType: 'image/jpeg' })
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('shows a frame as a picture whatever the tool result claimed it was', () => {
    // The mime rides in from a tool result, and a tool result can come from an
    // MCP server we did not write. It ends up inside a `data:` URL, so a value
    // that does not name a picture is not carried into one.
    expect(pictureMime('image/jpeg')).toBe('image/jpeg')
    expect(pictureMime('image/png')).toBe('image/png')
    expect(pictureMime('image/svg+xml')).toBe('image/svg+xml')
    expect(pictureMime('text/html')).toBe('image/jpeg')
    expect(pictureMime('image/jpeg;base64,x"onerror="alert(1)')).toBe('image/jpeg')
    expect(pictureMime('')).toBe('image/jpeg')
  })

  it('keeps a bounded number of frames, so a long session does not grow forever', async () => {
    // Correctness never needed the bound - the route is immutable - but a
    // window left open for days does: one base64 frame per acting call, held
    // for the life of the process, is tens of megabytes nobody is looking at.
    const transport: AttachmentBytes = vi.fn(async () => bytesOf('frame-bytes'))
    setAttachmentBytesTransport(transport)

    // The limit is 120; asking for more evicts the oldest first.
    for (let index = 0; index < 121; index += 1) {
      await attachmentDataUrl('conv_cap', { id: `att_msg_${index}_0`, mimeType: 'image/jpeg' })
    }
    expect(transport).toHaveBeenCalledTimes(121)

    // The newest is still cached, and asking again costs nothing.
    await attachmentDataUrl('conv_cap', { id: 'att_msg_120_0', mimeType: 'image/jpeg' })
    expect(transport).toHaveBeenCalledTimes(121)

    // The oldest was evicted, so scrolling back to it asks the route again.
    await attachmentDataUrl('conv_cap', { id: 'att_msg_0_0', mimeType: 'image/jpeg' })
    expect(transport).toHaveBeenCalledTimes(122)
  })
})
