import { describe, expect, it } from 'vitest'
import { ClientObservationBuffer } from './events'

describe('client observation source', () => {
  it('creates no events before host opt-in and clears pending events on epoch changes', () => {
    const source = new ClientObservationBuffer()
    source.record({ name: 'client.window', phase: 'start' })
    expect(source.take()).toBeNull()
    source.configure('first')
    source.record({ name: 'client.window', phase: 'start' })
    source.configure('second')
    expect(source.take()).toBeNull()
    source.record({ name: 'client.window', phase: 'start' })
    expect(source.take()?.captureId).toBe('second')
  })

  it('preserves source identity and sequence while bounding queue and upload batches', () => {
    const source = new ClientObservationBuffer()
    source.configure('capture')
    for (let at = 0; at < 205; at++) source.record({ name: 'client.delivery', phase: 'progress', identity: { streamId: 'stream' }, attributes: { count: at } })
    const batch = source.take()
    expect(source.dropped).toBe(5)
    expect(batch?.events).toHaveLength(50)
    expect(batch?.events[0]?.sequence).toBe(6)
    expect(new Set(batch?.events.map((event) => event.eventId)).size).toBe(50)
    expect(new Set(batch?.events.map((event) => event.bootId)).size).toBe(1)
    expect(source.take()?.events[0]?.sequence).toBe(56)
  })

  it('never enumerates arbitrary metadata or invokes getters', () => {
    const source = new ClientObservationBuffer()
    source.configure('capture')
    const hostile = new Proxy({ stage: 'queued', get failure(): string { throw new Error('getter invoked') } }, {
      ownKeys() { throw new Error('enumerated arbitrary metadata') },
    })
    source.record({ name: 'client.request', phase: 'start', attributes: hostile })
    expect(source.take()?.events[0]?.attributes).toEqual({ stage: 'queued' })
  })
})
