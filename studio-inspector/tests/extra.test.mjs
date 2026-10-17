import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixture, event, batch } from './helpers.mjs'
import { query } from '../src/queries.mjs'
import { normalize } from '../src/normalize.mjs'
import { redact } from '../src/redact.mjs'
const run = promisify(execFile)
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url))

test('native evidence remains readable without invented conversation joins; original envelopes are paged', async (t) => {
  const { store } = fixture(t)
  store.ingest('desktop', batch([event(1, { identity: { requestId: 'shared-request' }, extraEvidence: { future: true } })], { namespace: 'native' }))
  assert.equal(store.sessions().sessions.length, 0)
  const page = await query(store, 'get_source_timeline', { sourceId: 'desktop.native' })
  assert.equal(page.events[0].identity.requestId, 'shared-request')
  const raw = await query(store, 'read_event', { cursor: page.events[0].cursor })
  assert.deepEqual(JSON.parse(raw.text).extraEvidence, { future: true })
  assert(!Object.hasOwn(JSON.parse(raw.text), 'content'))
  await assert.rejects(query(store, 'read_event', { cursor: -1 }), { code: 'invalid_argument' })
})

test('watch cancellation ends inspection without changing retained execution evidence', async (t) => {
  const { store } = fixture(t)
  store.ingest('desktop', batch([event(1)]))
  const controller = new AbortController()
  const waiting = query(store, 'watch_session', { sessionId: store.sessions().sessions[0].id, after: 1, timeoutMs: 20000 }, controller.signal)
  controller.abort()
  await assert.rejects(waiting, { code: 'cancelled' })
  assert.equal(store.status().retained.count, 1)
})

test('operator CLI exports, imports and erases isolated stores; export refuses overwrite', async (t) => {
  const { store, path, root } = fixture(t)
  store.ingest('a'.repeat(100), batch([event(1)]), { includeContent: true })
  const archive = join(root, 'archive.json'); const other = join(root, 'other.sqlite')
  const session = store.sessions().sessions[0].id
  await run(process.execPath, [cli, 'export', '--store', path, '--session', session, '--output', archive, '--include-content'])
  await assert.rejects(run(process.execPath, [cli, 'export', '--store', path, '--session', session, '--output', archive]))
  const imported = await run(process.execPath, [cli, 'import', '--store', other, '--input', archive, '--include-content'])
  assert.equal(JSON.parse(imported.stdout).inserted, 1)
  const sessions = JSON.parse((await run(process.execPath, [cli, 'sessions', '--store', other])).stdout)
  assert.equal(sessions.sessions[0].conversation, 'conversation')
  await run(process.execPath, [cli, 'erase', '--store', other])
  const status = JSON.parse((await run(process.execPath, [cli, 'status', '--store', other])).stdout)
  assert.equal(status.retained.count, 0)
})

test('native timestamps and feed provenance are validated without hiding source status', () => {
  assert.throws(() => normalize({ format: 'project-studio.native-diagnostics', version: 1, native: { events: [{ unixMs: 1e100 }] } }), { code: 'invalid_native' })
  const [batch] = normalize({ format: 'project-studio.inspector-feed', version: 1, status: 'paused', feedId: 'feed', snapshotId: 'snapshot', writtenAtUnixMs: 123 })
  assert.equal(batch.health.bridgeStatus, 'paused')
  assert.equal(batch.health.snapshotId, 'snapshot')
  const mixed = { format: 'studio-inspector.archive', version: 1, batches: [{ namespace: 'native', bootId: 'one', captureId: 'capture', events: [event(1)] }] }
  assert.throws(() => normalize(mixed), { code: 'mixed_boot' })
})

test('projection limits label omissions and collector failures still enforce receipt-age retention', (t) => {
  const { store } = fixture(t)
  const projected = redact(Array.from({ length: 2001 }, () => 'item'))
  assert.equal(projected.at(-1), '[omitted: array limit]')
  store.ingest('desktop', batch([event(1)]), { now: Date.now() - 8 * 86400000 })
  assert.equal(store.status().retained.count, 1)
  store.sourceFailure('desktop', 'feed_unavailable')
  assert.equal(store.status().retained.count, 0)
  assert.equal(store.status().retentionRemoved, 1)
})

test('provider tool IDs are scoped by submission and turn rather than assumed globally unique', async (t) => {
  const { store } = fixture(t)
  store.ingest('desktop', batch([
    event(1, { name: 'runtime.tool', identity: { conversationId: 'conversation', submissionId: 'submission', turnId: 'turn-one', toolCallId: 'call_0' } }),
    event(2, { name: 'runtime.tool', outcome: 'failed', identity: { conversationId: 'conversation', submissionId: 'submission', turnId: 'turn-two', toolCallId: 'call_0' } }),
  ]))
  const overview = await query(store, 'get_session_overview', { sessionId: store.sessions().sessions[0].id })
  assert.equal(overview.logicalToolCallsIdentified, 2)
  assert.equal(overview.failedLogicalToolCallsIdentified, 1)
})

test('a collector that stopped updating cannot advertise a fresh live source indefinitely', (t) => {
  const { store } = fixture(t)
  store.ingest('desktop', batch([event(1)], { health: { bridgeStatus: 'ready' } }), { now: Date.now() - 30000, liveCursor: true })
  const source = store.status().sources[0]
  assert.equal(source.health.collectorStatus, 'collector_silent')
  assert(source.receiptAgeMs >= 30000)
  store.ingest('history', batch([event(1)], { health: { bridgeStatus: 'ready' } }), { now: Date.now() - 30000 })
  assert.equal(store.status().sources.find((source) => source.id === 'history.harness').health.collectorStatus, 'imported')
})
