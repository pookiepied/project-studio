import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { writeFile, open, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { fixture, event, batch, feed } from './helpers.mjs'
import { collect, importFile } from '../src/collect.mjs'

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url))

async function client(cleanup, path) {
  const child = spawn(process.execPath, [cli, 'mcp', '--store', path], { stdio: ['pipe', 'pipe', 'pipe'], shell: false, env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } })
  const waiting = new Map(); const lines = []; let next = 0; let stderr = ''
  child.stderr.on('data', (bytes) => { stderr += bytes.toString() })
  createInterface({ input: child.stdout }).on('line', (line) => {
    const value = JSON.parse(line); lines.push(value)
    const waiter = waiting.get(value.id)
    if (waiter) { waiting.delete(value.id); waiter(value) }
  })
  cleanup.push(async () => {
    for (const resolve of waiting.values()) resolve({ error: { message: 'child closed' } })
    child.stdin.end()
    if (child.exitCode === null) await new Promise((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  })
  const notify = (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  const request = (method, params) => {
    const id = ++next
    const response = new Promise((resolve) => waiting.set(id, resolve))
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`RPC timeout ${id}: ${stderr}`)), 5000)
      response.then((value) => { clearTimeout(timer); resolve(value) }, reject)
    })
  }
  const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } })
  assert.equal(initialized.result.protocolVersion, '2025-11-25')
  notify('notifications/initialized')
  return { child, request, notify, lines }
}

test('real stdio MCP discovers read-only tools and pages actual retained evidence', async (t) => {
  const { store, path, cleanup } = fixture(t)
  store.ingest('desktop', batch([event(1)]), { includeContent: true })
  const rpc = await client(cleanup, path)
  const list = await rpc.request('tools/list')
  assert(list.result.tools.every((tool) => tool.annotations.readOnlyHint && tool.annotations.destructiveHint === false))
  assert(!list.result.tools.some((tool) => /import|erase|execute|configure/.test(tool.name)))
  const sessions = await rpc.request('tools/call', { name: 'list_sessions', arguments: {} })
  const session = JSON.parse(sessions.result.content[0].text).sessions[0].id
  const timeline = await rpc.request('tools/call', { name: 'get_timeline', arguments: { sessionId: session } })
  const row = JSON.parse(timeline.result.content[0].text).events[0]
  assert.equal(row.id, 'event-1')
  assert.equal(Object.hasOwn(row, 'content'), false)
  const payload = await rpc.request('tools/call', { name: 'read_payload', arguments: { sessionId: session, payloadId: row.payload } })
  assert.deepEqual(JSON.parse(JSON.parse(payload.result.content[0].text).text), { answer: 'result-1' })
  const refusal = await rpc.request('tools/call', { name: 'execute', arguments: { command: 'ignored' } })
  assert.equal(refusal.result.isError, true)
})

test('bounded watch sees a separately persisted event without replaying old observations', async (t) => {
  const { store, path, cleanup } = fixture(t)
  store.ingest('desktop', batch([event(1)]))
  const session = store.sessions().sessions[0].id
  const rpc = await client(cleanup, path)
  const watch = rpc.request('tools/call', { name: 'watch_session', arguments: { sessionId: session, after: 1, timeoutMs: 3000 } })
  await delay(100)
  store.ingest('desktop', batch([event(2)]))
  const result = JSON.parse((await watch).result.content[0].text)
  assert.deepEqual(result.events.map((row) => row.id), ['event-2'])
  assert.equal(result.nextCursor, 2)
  const empty = await rpc.request('tools/call', { name: 'watch_session', arguments: { sessionId: session, after: 2, timeoutMs: 0 } })
  assert.equal(JSON.parse(empty.result.content[0].text).timedOut, true)
})

test('a local feed can be collected by one process and read through another MCP connection', async (t) => {
  const { store, root, path, cleanup } = fixture(t)
  const source = join(root, 'feed.json')
  await writeFile(source, JSON.stringify(feed([event(1)])))
  await collect(store, source, 'desktop', { once: true, includeContent: true })
  await collect(store, source, 'desktop', { once: true, includeContent: true })
  assert.equal(store.status().retained.count, 1)
  const rpc = await client(cleanup, path)
  const result = await rpc.request('tools/call', { name: 'list_sessions' })
  assert.equal(JSON.parse(result.result.content[0].text).sessions[0].conversation, 'conversation')
  await writeFile(source, '{incomplete')
  await assert.rejects(collect(store, source, 'desktop', { once: true }))
  assert.equal(store.status().retained.count, 1)
  assert.equal(store.status().sources[0].health.collectorStatus, 'invalid_json')
})

test('malformed or oversized stdio frames cannot become a generic execution API', async (t) => {
  const { path, cleanup } = fixture(t)
  const rpc = await client(cleanup, path)
  rpc.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'ping', params: { padding: 'x'.repeat(70_000) } })}\n`)
  await rpc.request('ping')
  assert(rpc.lines.some((line) => line.error?.code === -32700))
  assert(!rpc.lines.some((line) => line.id === 99))
  const result = await rpc.request('tools/call', { name: 'get_inspector_status', arguments: { path: 'unapproved' } })
  assert.equal(result.result.isError, true)
  assert.equal(JSON.parse(result.result.content[0].text).error.code, 'invalid_argument')
  assert.deepEqual((await rpc.request('ping')).result, {})
})

test('historical input parsing refuses oversized and unsupported files without partial rows', async (t) => {
  const { store, root } = fixture(t)
  const path = join(root, 'input.json')
  await writeFile(path, JSON.stringify({ format: 'unrelated', version: 1 }))
  await assert.rejects(importFile(store, path, 'history', {}), { code: 'unsupported_format' })
  assert.equal(store.status().retained.count, 0)
  const file = await open(path, 'r+')
  try { await file.truncate(48 * 1024 * 1024 + 1) } finally { await file.close() }
  await assert.rejects(importFile(store, path, 'history', {}), { code: 'input_limit' })
  assert.equal(store.status().retained.count, 0)
})

test('a stale desktop feed is reported instead of ingested', async (t) => {
  const { store, root } = fixture(t)
  const path = join(root, 'feed.json')
  await writeFile(path, JSON.stringify(feed([event(1)])))
  const past = new Date(Date.now() - 30000)
  await utimes(path, past, past)
  await collect(store, path, 'desktop', { once: true })
  assert.equal(store.status().retained.count, 0)
  assert.equal(store.status().sources[0].health.collectorStatus, 'feed_stale')
})

test('a new host can discover tools before its operator creates a store', async (t) => {
  const { root, cleanup } = fixture(t)
  const rpc = await client(cleanup, join(root, 'not-created.sqlite'))
  assert((await rpc.request('tools/list')).result.tools.length > 0)
  const response = await rpc.request('tools/call', { name: 'get_inspector_status', arguments: {} })
  assert.equal(JSON.parse(response.result.content[0].text).error.code, 'store_missing')
})
