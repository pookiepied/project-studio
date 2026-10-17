import { fail, record, text } from './errors.mjs'
import { hash } from './redact.mjs'

export const MAX_INPUT_BYTES = 48 * 1024 * 1024
const outcomes = new Set(['completed', 'failed', 'cancelled', 'unknown'])
const phases = new Set(['start', 'progress', 'end'])

function observation(value) {
  if (!record(value) || value.v !== 1 || !text(value.eventId) || !text(value.bootId) ||
    !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !text(value.name, 160) ||
    !phases.has(value.phase) || !record(value.identity) || !record(value.attributes) ||
    !text(value.timestamp, 80) || !Number.isFinite(Date.parse(value.timestamp)) ||
    !Number.isFinite(value.monotonicMs) || value.monotonicMs < 0 ||
    (value.outcome !== undefined && !outcomes.has(value.outcome))) {
    fail('invalid_observation', 'An observation does not match the supported Studio contract.')
  }
  for (const id of Object.values(value.identity)) {
    if (!text(id)) fail('invalid_identity', 'An observation identity is invalid or too large.')
  }
  return value
}

function native(snapshot) {
  if (snapshot === null || snapshot === undefined) return null
  if (!record(snapshot) || !Array.isArray(snapshot.events) || snapshot.events.length > 2000) fail('invalid_native', 'The native snapshot is invalid or unsupported.')
  const events = snapshot.events.map((item) => {
    if (!record(item) || !Number.isFinite(item.unixMs) || Math.abs(item.unixMs) > 8.64e15) fail('invalid_native', 'A native observation is invalid.')
    return observation({ ...item, timestamp: new Date(item.unixMs).toISOString(),
      identity: Object.fromEntries(['operationId', 'requestId', 'streamId'].flatMap((key) => text(item[key]) ? [[key, item[key]]] : [])),
      attributes: Object.fromEntries(['stage', 'status', 'durationMs', 'errorCode'].flatMap((key) => item[key] === null || item[key] === undefined ? [] : [[key, item[key]]])),
      ...(item.outcome === null ? { outcome: undefined } : {}), contentState: 'absent',
    })
  })
  if (events.some((event) => event.bootId !== snapshot.bootId)) fail('mixed_boot', 'The native snapshot contains mixed source boots.')
  return { namespace: 'native', bootId: text(snapshot.bootId) ?? 'unknown-native',
    captureId: text(snapshot.captureId) ?? 'unscoped-native', events,
    health: { dropped: snapshot.dropped ?? null, evicted: snapshot.evicted ?? null }, gap: false }
}

function diagnostic(input) {
  if (!record(input.health) || !text(input.health.bootId) || !text(input.health.captureId) ||
    !Array.isArray(input.events) || input.events.length > 10_000) fail('invalid_snapshot', 'The diagnostic snapshot is invalid or unsupported.')
  const events = input.events.map(observation)
  if (events.some((event) => event.bootId !== input.health.bootId)) fail('mixed_boot', 'The snapshot contains mixed source boots.')
  return { namespace: 'harness', bootId: input.health.bootId, captureId: input.health.captureId,
    events, health: { ...input.health, nativeEvidence: input.native ? 'supplied' : input.nativeUnavailable ? 'unavailable' : 'not_supplied' }, gap: input.gap === true }
}

function historic(input) {
  if (!Array.isArray(input.conversations) || input.conversations.length > 10_000) fail('invalid_export', 'The conversation export is invalid.')
  const events = []
  const exported = text(input.exportedAt, 80)
  const timestamp = exported && Number.isFinite(Date.parse(exported)) ? exported : '1970-01-01T00:00:00.000Z'
  for (const conversation of input.conversations) {
    if (!record(conversation) || !text(conversation.conversationId) || !Array.isArray(conversation.streams)) fail('invalid_export', 'A conversation export entry is invalid.')
    for (const stream of conversation.streams) {
      if (!record(stream) || !text(stream.path, 2048) || !Array.isArray(stream.entries) || !Array.isArray(stream.records)) fail('invalid_export', 'A conversation stream is invalid.')
      const base = { conversationId: conversation.conversationId,
        ...(text(stream.agent) ? { agentName: stream.agent } : {}) }
      const emit = (name, key, content, identity = {}, phase = 'progress', outcome) => {
        if (events.length >= 20_000) fail('input_limit', 'Split this export into smaller recordings before importing it.')
        const eventId = `history_${hash(JSON.stringify([conversation.conversationId, stream.path, key, content]))}`
        events.push({ v: 1, eventId, bootId: 'historical-export-v1', sequence: events.length + 1,
          timestamp, monotonicMs: 0, name, phase, ...(outcome ? { outcome } : {}),
          identity: { ...base, ...identity }, attributes: { timing: 'unavailable', origin: 'journal_export' },
          content, contentState: 'captured' })
      }
      for (const [index, entry] of stream.entries.entries()) {
        if (!record(entry)) continue
        const message = record(entry.message) ? entry.message : null
        const identity = message && text(message.submissionId) ? { submissionId: message.submissionId } : {}
        if (message) {
          emit(message.role === 'assistant' ? 'history.assistant' : 'history.user', `entry-${index}`, message, identity)
          if (message.role === 'assistant' && Array.isArray(message.blocks)) {
            for (const [blockIndex, block] of message.blocks.entries()) {
              if (!record(block) || block.type !== 'tool_call') continue
              const settled = record(block.result)
              emit('history.tool', `tool-${index}-${blockIndex}`, block,
                { ...identity, ...(text(block.toolCallId) ? { toolCallId: block.toolCallId } : {}) },
                settled ? 'end' : 'progress', settled ? block.result.isError === true ? 'failed' : 'completed' : undefined)
            }
          }
        } else emit('history.entry', `entry-${index}`, entry)
      }
      for (const [index, submission] of (Array.isArray(stream.submissions) ? stream.submissions : []).entries()) {
        if (!record(submission) || !text(submission.submissionId)) continue
        const outcome = submission.outcome === 'aborted' ? 'cancelled' : outcomes.has(submission.outcome) ? submission.outcome : undefined
        emit('history.submission', `submission-${index}`, submission, { submissionId: submission.submissionId }, outcome ? 'end' : 'progress', outcome)
      }
      for (const [index, value] of stream.records.entries()) emit('history.record', `record-${index}`, value)
      for (const [index, value] of (Array.isArray(stream.unparsedBatches) ? stream.unparsedBatches : []).entries()) emit('history.unparsed', `unparsed-${index}`, value)
      if (Array.isArray(stream.losses) && stream.losses.length) emit('history.loss', 'losses', stream.losses)
    }
  }
  return { namespace: 'history', bootId: 'historical-export-v1', captureId: 'historical-export-v1',
    events, health: { timing: 'unavailable', content: 'operator_import', historical: true }, gap: false }
}

/** Unknown envelope formats fail closed; unknown fields inside known events survive. */
export function normalize(input) {
  if (!record(input)) fail('invalid_export', 'Expected a supported Studio export object.')
  if (input.format === 'project-studio.conversation-export' && input.formatVersion === 1) return [historic(input)]
  if (input.version !== 1) fail('unsupported_version', 'This recording version is not supported.')
  if (input.format === 'studio-inspector.archive') {
    if (!Array.isArray(input.batches) || input.batches.length > 1000) fail('invalid_archive', 'The Inspector archive is invalid.')
    if (input.batches.reduce((count, batch) => count + (Array.isArray(batch?.events) ? batch.events.length : 0), 0) > 20_000) fail('input_limit', 'Split this archive into smaller recordings.')
    return input.batches.map((batch) => {
      if (!record(batch) || !text(batch.namespace, 100) || !text(batch.bootId) || !text(batch.captureId) ||
        !Array.isArray(batch.events) || batch.events.length > 20_000) fail('invalid_archive', 'An archive batch is invalid.')
      const events = batch.events.map(observation)
      if (events.some((event) => event.bootId !== batch.bootId)) fail('mixed_boot', 'The archive contains mixed source boots.')
      return { ...batch, events }
    })
  }
  if (input.format === 'project-studio.inspector-feed' && input.status !== 'ready') {
    if (!['paused', 'unavailable', 'disabled'].includes(input.status)) fail('invalid_snapshot', 'The Inspector feed status is invalid.')
    const host = native(input.native)
    return [{ namespace: 'harness', bootId: text(input.health?.bootId) ?? text(input.feedId) ?? 'unavailable', captureId: text(input.health?.captureId) ?? 'unavailable',
      events: [], health: { bridgeStatus: input.status, feedId: input.feedId, snapshotId: input.snapshotId,
        writtenAtUnixMs: input.writtenAtUnixMs, policy: input.health?.policy }, gap: false }, ...(host ? [host] : [])]
  }
  if (input.format === 'project-studio.diagnostics' || input.format === 'project-studio.inspector-feed') {
    const host = native(input.native)
    const harness = diagnostic(input)
    if (input.format === 'project-studio.inspector-feed') harness.health = { ...harness.health,
      bridgeStatus: 'ready', feedId: input.feedId, snapshotId: input.snapshotId, writtenAtUnixMs: input.writtenAtUnixMs }
    return [harness, ...(host ? [host] : [])]
  }
  if (input.format === 'project-studio.native-diagnostics') {
    const host = native(input.native)
    if (!host) fail('invalid_native', 'The native snapshot is unavailable.')
    return [host]
  }
  fail('unsupported_format', 'Use a version 1 Studio diagnostic, native or conversation JSON export.')
}
