import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixture, event, feed } from './helpers.mjs'
import { collect } from '../src/collect.mjs'

test('published native feed crosses collector storage and a real stdio MCP process', async (t) => {
  const { store, path, root } = fixture(t)
  const input = process.env.STUDIO_INSPECTOR_TEST_FEED ?? join(root, 'feed.json')
  if (!process.env.STUDIO_INSPECTOR_TEST_FEED) writeFileSync(input, JSON.stringify(feed([event(1)])))
  await collect(store, input, 'desktop', { once: true, includeContent: true })
  assert.equal(store.status().retained.count, 1)
  const sessionId = store.sessions().sessions[0].id
  const messages = [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/call', params: { name: 'get_timeline', arguments: { sessionId } } },
  ]
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), 'mcp', '--store', path], {
    input: messages.map((message) => JSON.stringify({ jsonrpc: '2.0', ...message })).join('\n') + '\n',
    encoding: 'utf8', timeout: 5000, maxBuffer: 131072, shell: false,
  })
  assert.equal(child.status, 0, child.stderr)
  const response = child.stdout.trim().split('\n').map((line) => JSON.parse(line)).find((message) => message.id === 2)
  const result = JSON.parse(response.result.content[0].text)
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].identity.conversationId, 'conversation')
  assert.equal(response.result.isError, false)
})
