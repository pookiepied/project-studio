import { describe, expect, it, vi } from 'vitest'

import { composeStreamUrl, httpStream } from './stream'
import type { WireStreamEvent } from './contracts'

/**
 * Reading a run in a browser.
 *
 * The rules here are not this file's own: they are `services/stream.rs`'s
 * `deliver`, transferred. A `control` frame is the protocol talking and every
 * other frame is content; the offset in force travels with each event, because
 * that offset is the only durable thing a reader knows about where it has read
 * to. Getting this wrong does not look like an error - it looks like a
 * conversation that replays the wrong events, or skips one, after any
 * interruption. So each rule is pinned rather than trusted to a reading of the
 * Rust.
 */

const encoder = new TextEncoder()

/** A response whose body arrives as exactly these chunks. */
function streaming(chunks: readonly string[], init?: { status?: number; type?: string }): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return {
    ok: (init?.status ?? 200) < 400,
    status: init?.status ?? 200,
    headers: { get: () => init?.type ?? 'text/event-stream' } as unknown as Headers,
    body,
    text: async () => '',
  } as unknown as Response
}

/** A refusal, with a body the reader should carry into its message. */
function refusal(status: number, body: string): Response {
  return {
    ok: false,
    status,
    headers: { get: () => 'application/json' } as unknown as Headers,
    body: null,
    text: async () => body,
  } as unknown as Response
}

/** Reads one scripted stream to the end and returns what it delivered. */
async function read(
  response: Response,
  offset = '4_2',
): Promise<{ events: WireStreamEvent[]; url: string; failure: unknown }> {
  const events: WireStreamEvent[] = []
  let url = ''
  const open = httpStream(async (input: RequestInfo | URL) => {
    // The reader always passes a string path. The other two arms are here
    // because `fetch`'s signature allows them, and each has its own way of
    // naming an address - a `Request` does not stringify into one.
    url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return response
  })
  const handle = open({
    path: '/agents/studio/cnv_1?view=updates',
    offset,
    onEvent: (event) => events.push(event),
    streamId: 'stream_1',
  })
  let failure: unknown = null
  await handle.settled.catch((error: unknown) => {
    failure = error
  })
  return { events, url, failure }
}

describe('composing the stream URL', () => {
  it('adds the offset and the live mode to the path the caller named', () => {
    expect(composeStreamUrl('/agents/studio/cnv_1?view=updates', '6_1')).toBe(
      '/agents/studio/cnv_1?view=updates&offset=6_1&live=sse',
    )
    // No query of its own: the offset starts one.
    expect(composeStreamUrl('/agents/studio/cnv_1', '-1')).toBe(
      '/agents/studio/cnv_1?offset=-1&live=sse',
    )
  })

  it('leaves a live mode the caller chose alone', () => {
    expect(composeStreamUrl('/x?live=poll', '3')).toBe('/x?live=poll&offset=3')
  })

  it('refuses a path that already carries an offset, rather than sending two', () => {
    // The harness would reject two offsets and the error would name the
    // wrong layer, so this is caught where the mistake actually is.
    expect(() => composeStreamUrl('/x?offset=1', '2')).toThrow()
  })

  it('refuses a fragment, which the offset would join instead of the query', () => {
    expect(() => composeStreamUrl('/x#anchor', '2')).toThrow()
  })

  it('refuses an empty offset: a read must say where it resumes from', () => {
    expect(() => composeStreamUrl('/x', '')).toThrow()
  })

  it('percent-encodes the offset so it cannot become query structure', () => {
    expect(composeStreamUrl('/x', 'a&b=c')).toBe('/x?offset=a%26b%3Dc&live=sse')
  })
})

describe('reading a run over HTTP', () => {
  it('delivers a content frame carrying the offset currently in force', async () => {
    const { events } = await read(streaming(['data: {"a":1}\n\n']))
    expect(events).toEqual([{ kind: 'frame', offset: '4_2', data: '{"a":1}' }])
  })

  it('moves the offset on a control frame, and says so once it is up to date', async () => {
    const { events } = await read(
      streaming([
        'event: control\ndata: {"streamNextOffset":"7_0","upToDate":true}\n\n',
        'data: after\n\n',
      ]),
    )
    expect(events).toEqual([
      { kind: 'up-to-date', offset: '7_0' },
      // The frame after it carries the offset the control frame moved to,
      // which is what makes a reattach resume in the right place.
      { kind: 'frame', offset: '7_0', data: 'after' },
    ])
  })

  it('announces being up to date once, not on every control frame that says so', async () => {
    const { events } = await read(
      streaming([
        'event: control\ndata: {"streamNextOffset":"7_0","upToDate":true}\n\n',
        'event: control\ndata: {"streamNextOffset":"7_1","upToDate":true}\n\n',
      ]),
    )
    expect(events.filter((event) => event.kind === 'up-to-date')).toHaveLength(1)
  })

  it('re-arms when the stream falls behind, so a later catch-up is reported again', async () => {
    // Falling behind has no event of its own - frames arriving says it - but
    // the transition has to re-arm or the second catch-up goes unannounced.
    const { events } = await read(
      streaming([
        'event: control\ndata: {"streamNextOffset":"7_0","upToDate":true}\n\n',
        'event: control\ndata: {"streamNextOffset":"7_1","upToDate":false}\n\n',
        'event: control\ndata: {"streamNextOffset":"7_2","upToDate":true}\n\n',
      ]),
    )
    expect(events).toEqual([
      { kind: 'up-to-date', offset: '7_0' },
      { kind: 'up-to-date', offset: '7_2' },
    ])
  })

  it('ends on the close frame and reads nothing after it', async () => {
    const { events, failure } = await read(
      streaming([
        'event: control\ndata: {"streamNextOffset":"9_0","closed":true}\n\n',
        'data: never-read\n\n',
      ]),
    )
    expect(failure).toBeNull()
    expect(events).toEqual([{ kind: 'ended', offset: '9_0' }])
  })

  it('breaks the stream when a control frame is not the protocol', async () => {
    // Without the resume point the contract this design rests on is already
    // broken, so a quiet guess would be worse than saying so.
    const missing = await read(streaming(['event: control\ndata: {"upToDate":true}\n\n']))
    expect(missing.failure).toEqual({
      kind: 'stream-broken',
      message: 'a control frame carried no streamNextOffset',
    })

    const invalid = await read(streaming(['event: control\ndata: not json\n\n']))
    expect(invalid.failure).toEqual({
      kind: 'stream-broken',
      message: 'a control frame was not valid JSON',
    })
  })

  it('reports a refusal with its status and the harness sentence', async () => {
    const { failure } = await read(refusal(401, '{"error":"That credential is not current."}'))
    expect(failure).toEqual({
      kind: 'stream-refused',
      status: 401,
      message: '{"error":"That credential is not current."}',
    })
  })

  it('refuses an answer that is not an event stream, however successful', async () => {
    // A 200 carrying HTML is a login page or a proxy notice, not a run. It
    // must not be read as an empty stream that simply ended.
    const { failure } = await read(streaming(['<html>'], { type: 'text/html' }))
    expect(failure).toEqual({
      kind: 'stream-refused',
      status: 200,
      message: 'answered 200 with content-type text/html',
    })
  })

  it('asks for an event stream and nothing cached', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      streaming([]),
    )
    const open = httpStream(fetchImpl)
    await open({
      path: '/agents/studio/cnv_1?view=updates',
      offset: '-1',
      onEvent: () => {},
      streamId: 'stream_1',
    }).settled

    const init = fetchImpl.mock.calls[0]?.[1]
    expect((init?.headers as Record<string, string>)['accept']).toBe('text/event-stream')
    // A conversation stream served from a cache is a conversation that
    // silently stopped moving.
    expect(init?.cache).toBe('no-store')
  })

  it('cancelling stops the read without failing it', async () => {
    // Cancelling stops READING a run; it never stops the run (ADR 0045 §5).
    // So it settles quietly rather than as a broken stream.
    // Held in a property rather than a bare `let`: the assignment happens
    // inside a callback, and control-flow narrowing would call it `never`.
    const feed: { push: ((chunk: string) => void) | null } = { push: null }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        feed.push = (chunk) => controller.enqueue(encoder.encode(chunk))
      },
    })
    const response = {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' } as unknown as Headers,
      body,
      text: async () => '',
    } as unknown as Response

    const events: WireStreamEvent[] = []
    const open = httpStream(async () => response)
    const handle = open({
      path: '/agents/studio/cnv_1?view=updates',
      offset: '1',
      onEvent: (event) => events.push(event),
      streamId: 'stream_1',
    })

    await vi.waitFor(() => expect(feed.push).not.toBeNull())
    feed.push?.('data: one\n\n')
    await vi.waitFor(() => expect(events).toHaveLength(1))

    await handle.cancel()
    await expect(handle.settled).resolves.toBeUndefined()
  })
})
