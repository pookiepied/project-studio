import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../src/store.mjs'
import { overview } from '../src/queries.mjs'
import { normalize } from '../src/normalize.mjs'
import { fixture, event, batch, feed } from './helpers.mjs'

test('redacts before persistence, preserves numeric usage and deduplicates replay', (t) => {
  const { store } = fixture(t)
  const value = event(1, { content: { apiKey: 'sk-secret-example-1234567890', environment: { PATH: 'private environment' },
    arguments: '{"password":"two private words"}', inputTokens: 42, text: 'Bearer private_token_value' } })
  assert.equal(store.ingest('desktop', batch([value]), { includeContent: true }).inserted, 1)
  assert.equal(store.ingest('desktop', batch([value]), { includeContent: true }).inserted, 0)
  const session = store.sessions().sessions[0].id
  const page = store.timeline(session)
  assert.equal(page.events.length, 1)
  assert.equal(Object.hasOwn(page.events[0], 'content'), false)
  const payload = store.payload(session, page.events[0].payload).text
  for (const secret of ['sk-secret-example', 'private environment', 'two private words', 'private_token_value']) assert.equal(payload.includes(secret), false)
  assert.equal(JSON.parse(payload).inputTokens, 42)
})

test('content requires the operator flag independently of source capture', (t) => {
  const { store } = fixture(t)
  store.ingest('desktop', batch([event(1)]))
  const session = store.sessions().sessions[0].id
  const row = store.timeline(session).events[0]
  assert.equal(row.payload, null)
  assert.equal(row.contentState, 'unavailable')
  assert.equal(store.db.prepare('SELECT COUNT(*) count FROM payloads').get().count, 0)
})

test('retention removes payloads and live watermarks prevent evicted replay resurrection', (t) => {
  const { store } = fixture(t, { events: 2 })
  const input = batch([event(1), event(2), event(3)])
  store.ingest('desktop', input, { includeContent: true, liveCursor: true })
  const before = store.status()
  assert.equal(before.retained.count, 2)
  assert.equal(before.retentionRemoved, 1)
  assert.equal(store.db.prepare('SELECT COUNT(*) count FROM payloads').get().count, 2)
  assert.equal(store.ingest('desktop', input, { includeContent: true, liveCursor: true }).inserted, 0)
  assert.equal(store.status().retained.cursor, before.retained.cursor)
  assert.equal(store.status().retentionRemoved, 1)
})

test('failed batches roll back both rows and durable source watermarks', (t) => {
  const { store } = fixture(t)
  assert.throws(() => store.ingest('desktop', batch([event(1), event(2, { identity: null })]), { liveCursor: true }))
  assert.equal(store.status().retained.count, 0)
  assert.equal(store.db.prepare('SELECT COUNT(*) count FROM watermarks').get().count, 0)
  assert.equal(store.ingest('desktop', batch([event(1)]), { liveCursor: true }).inserted, 1)
})

test('overview counts leaf turns and logical tools without summing rollups or replay', (t) => {
  const { store } = fixture(t)
  const identity = { conversationId: 'conversation', turnId: 'turn', toolCallId: 'call', submissionId: 'submission' }
  store.ingest('desktop', batch([
    event(1, { name: 'runtime.turn', identity, attributes: { usage: { input: 10, output: 5 } } }),
    event(2, { name: 'runtime.operation', attributes: { usage: { input: 500, output: 500 } } }),
    event(3, { name: 'tools.execute', identity, outcome: 'failed' }),
    event(4, { name: 'runtime.tool', identity, outcome: 'failed' }),
    event(5, { name: 'runtime.submission_settled', identity }),
  ]))
  store.ingest('desktop', batch([
    event(6, { bootId: 'second-boot', name: 'runtime.turn', identity, attributes: { usage: { input: 10, output: 5 } } }),
    event(7, { bootId: 'second-boot', name: 'runtime.submission_settled', identity }),
  ], { bootId: 'second-boot' }))
  const result = overview(store, store.sessions().sessions[0].id)
  assert.equal(result.modelTurnsIdentified, 1)
  assert.equal(result.usage.inputTokens, 10)
  assert.equal(result.usage.outputTokens, 5)
  assert.equal(result.logicalToolCallsIdentified, 1)
  assert.equal(result.failedLogicalToolCallsIdentified, 1)
  assert.equal(result.failedBoundaryObservations, 2)
  assert.equal(result.submissions.length, 1)
})

test('read-only query connections cannot delete or ingest', (t) => {
  const { store, path } = fixture(t)
  store.ingest('desktop', batch([event(1)]))
  const reader = new Store(path)
  try {
    assert.throws(() => reader.erase(), { code: 'read_only' })
    assert.throws(() => reader.ingest('desktop', batch([event(2)])), { code: 'read_only' })
    assert.throws(() => reader.db.prepare('DELETE FROM events').run())
    assert.equal(reader.status().retained.count, 1)
  } finally { reader.close() }
})

test('payload references cannot read another session and pages reassemble Unicode exactly', (t) => {
  const { store } = fixture(t)
  store.ingest('desktop', batch([event(1, { content: { text: 'a'.repeat(253) + '\u{1F600}' + 'b'.repeat(300) } }),
    event(2, { identity: { conversationId: 'other' } })]), { includeContent: true })
  const session = store.sessions().sessions.find((row) => row.conversation === 'conversation').id
  const other = store.sessions().sessions.find((row) => row.conversation === 'other').id
  const payload = store.timeline(session).events[0].payload
  assert.throws(() => store.payload(other, payload), { code: 'payload_missing' })
  let offset = 0; let result = ''
  for (;;) {
    const page = store.payload(session, payload, offset, 256)
    result += page.text
    if (page.nextOffset === null) break
    offset = page.nextOffset
  }
  assert.deepEqual(JSON.parse(result), { text: 'a'.repeat(253) + '\u{1F600}' + 'b'.repeat(300) })
})

test('unknown captured fields survive normalization and mixed source boots are refused', (t) => {
  const { store } = fixture(t)
  const input = feed([event(1, { futureField: { sourceVersion: 42 } })])
  store.ingest('desktop', normalize(input)[0], { includeContent: true })
  const envelope = JSON.parse(store.db.prepare('SELECT envelope FROM events').get().envelope)
  assert.equal(envelope.futureField.sourceVersion, 42)
  assert.throws(() => normalize(feed([event(1, { bootId: 'wrong' })])), { code: 'mixed_boot' })
  assert.throws(() => normalize({ ...input, version: 99 }), { code: 'unsupported_version' })
})
