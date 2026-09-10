import { describe, expect, it } from 'vitest'

import { SseParser, type SseFrame } from './sse'

/**
 * The framing rules, pinned by the same list the Rust parser carries.
 *
 * Two implementations of one grammar only stay honest if they are held to the
 * same cases, so this file is a deliberate transfer of `services/sse.rs`'s
 * tests rather than a fresh set written from the same spec. A case that exists
 * on one side and not the other is exactly how the desktop window and a phone
 * would begin to disagree about what the harness said.
 *
 * Every test drives the parser with chosen chunk boundaries, because network
 * chunks fall wherever they fall and the bugs live at the boundaries rather
 * than in the field grammar.
 */

const encoder = new TextEncoder()

/** The stream, delivered as exactly these chunks. */
function framesOf(chunks: readonly string[]): readonly SseFrame[] {
  const parser = new SseParser()
  const frames: SseFrame[] = []
  for (const chunk of chunks) frames.push(...parser.push(encoder.encode(chunk)))
  frames.push(...parser.finish())
  return frames
}

/** The same, for a stream delivered as raw bytes rather than text. */
function framesOfBytes(chunks: readonly Uint8Array[]): readonly SseFrame[] {
  const parser = new SseParser()
  const frames: SseFrame[] = []
  for (const chunk of chunks) frames.push(...parser.push(chunk))
  frames.push(...parser.finish())
  return frames
}

describe('reading server-sent events', () => {
  it('keeps the event name with its data', () => {
    expect(framesOf(['event: message\ndata: hello\n\n'])).toEqual([
      { event: 'message', data: 'hello' },
    ])
  })

  it('joins multi-line data with newlines, as the spec requires', () => {
    const frames = framesOf(['data: one\ndata: two\n\n'])
    expect(frames).toHaveLength(1)
    expect(frames[0]?.data).toBe('one\ntwo')
    expect(frames[0]?.event).toBeNull()
  })

  it('ignores comment lines', () => {
    const frames = framesOf([': a comment\ndata: hello\n\n'])
    expect(frames).toHaveLength(1)
    expect(frames[0]?.data).toBe('hello')
  })

  it('drops a block with no data, which is what a keep-alive is', () => {
    expect(framesOf([': keep-alive\n\n'])).toEqual([])
    // An event name with no data is not an event either; the name is
    // discarded with the block rather than leaking into the next one.
    expect(framesOf(['event: ping\n\n'])).toEqual([])
    expect(framesOf(['event: ping\n\ndata: real\n\n'])).toEqual([
      { event: null, data: 'real' },
    ])
  })

  it('reads whole frames', () => {
    expect(framesOf(['data: one\n\ndata: two\n\n'])).toEqual([
      { event: null, data: 'one' },
      { event: null, data: 'two' },
    ])
  })

  it('joins a frame split anywhere in the middle', () => {
    expect(framesOf(['data: hel', 'lo\n', '\n'])).toEqual([{ event: null, data: 'hello' }])
  })

  it('keeps a CRLF frame whole when the chunk ends on the carriage return', () => {
    // The undecided case: that trailing \r is either half of a CRLF or a
    // line break on its own, and guessing early splits one break into two.
    expect(framesOf(['data: hello\r', '\n\r\n'])).toEqual([{ event: null, data: 'hello' }])
  })

  it('survives a CRLF cut at every position in the stream', () => {
    const stream = 'event: message\r\ndata: one\r\n\r\ndata: two\r\n\r\n'
    const expected = [
      { event: 'message', data: 'one' },
      { event: null, data: 'two' },
    ]
    for (let at = 0; at <= stream.length; at += 1) {
      expect(framesOf([stream.slice(0, at), stream.slice(at)]), `cut at ${at}`).toEqual(expected)
    }
  })

  it('reads a stream that uses lone carriage returns as line breaks', () => {
    expect(framesOf(['event: message\rdata: one\r\r'])).toEqual([
      { event: 'message', data: 'one' },
    ])
  })

  it('discards a truncated trailing frame rather than emitting half of it', () => {
    // No blank line, so the block never dispatched. Half a frame delivered as
    // if it were whole is worse than a frame not delivered at all.
    expect(framesOf(['data: complete\n\ndata: trunca'])).toEqual([
      { event: null, data: 'complete' },
    ])
  })

  it('handles a multi-byte character split across chunks', () => {
    // The reason bytes are buffered rather than text: decoding each chunk on
    // its own turns this into two replacement characters, silently.
    const bytes = encoder.encode('data: café\n\n')
    const cut = bytes.indexOf(0xc3) + 1
    expect(framesOfBytes([bytes.slice(0, cut), bytes.slice(cut)])).toEqual([
      { event: null, data: 'café' },
    ])
  })

  it('strips exactly one space after the field colon', () => {
    const frames = framesOf(['data:no-space\ndata: one-space\ndata:  two\n\n'])
    expect(frames).toHaveLength(1)
    expect(frames[0]?.data).toBe('no-space\none-space\n two')
  })

  it('treats a field with no colon as that field with an empty value', () => {
    // `data` alone is a data line carrying nothing, which still makes the
    // block a frame rather than a keep-alive.
    expect(framesOf(['data\n\n'])).toEqual([{ event: null, data: '' }])
  })

  it('ignores fields the protocol does not use here', () => {
    const frames = framesOf(['id: 7\nretry: 3000\nunknown: x\ndata: hello\n\n'])
    expect(frames).toEqual([{ event: null, data: 'hello' }])
  })
})
