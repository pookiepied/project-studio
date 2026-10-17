import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize } from '../src/normalize.mjs'
import { fixture } from './helpers.mjs'
import { overview } from '../src/queries.mjs'

test('imports the real conversation export shape without inventing provider timing', (t) => {
  const { store } = fixture(t)
  const input = { format: 'project-studio.conversation-export', formatVersion: 1, exportedAt: '2026-10-17T00:00:00Z',
    conversations: [{ conversationId: 'old-conversation', streams: [{ path: '/agents/studio/old', agent: 'studio', entries: [
      { kind: 'message', message: { role: 'user', text: 'Investigate', submissionId: 'old-submission' } },
      { kind: 'message', message: { role: 'assistant', submissionId: 'old-submission', blocks: [
        { type: 'tool_call', name: 'shell', toolCallId: 'old-call', arguments: { command: 'example' }, result: { content: [{ type: 'text', text: 'Failed' }], isError: true } },
      ] } },
    ], submissions: [{ submissionId: 'old-submission', outcome: 'failed' }], records: [{ type: 'future_kind', extra: 'unknown evidence' }], losses: ['No historical provider HTTP events.'], unparsedBatches: [{ seq: 9, data: 'not JSON' }] }] }] }
  const batches = normalize(input)
  store.ingest('old', batches[0], { includeContent: true })
  const session = store.sessions().sessions[0].id
  const result = overview(store, session)
  assert.equal(result.failedLogicalToolCallsIdentified, 1)
  assert.equal(result.usage.inputTokens, null)
  assert.equal(result.modelTurnsIdentified, 0)
  const timeline = store.timeline(session)
  assert(timeline.events.some((row) => row.name === 'history.unparsed'))
  const raw = timeline.events.find((row) => row.name === 'history.record')
  assert.equal(JSON.parse(store.payload(session, raw.payload).text).extra, 'unknown evidence')
  assert.equal(raw.attributes.timing, 'unavailable')
  assert.equal(store.ingest('old', normalize(input)[0], { includeContent: true }).inserted, 0)
})
