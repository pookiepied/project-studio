import { open } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { normalize, MAX_INPUT_BYTES } from './normalize.mjs'
import { hash } from './redact.mjs'
import { InspectorError, fail } from './errors.mjs'

export async function readInput(path) {
  const file = await open(path, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) fail('input_limit', 'Choose a regular Studio export or feed smaller than 48MiB.')
    const bytes = Buffer.alloc(Math.min(MAX_INPUT_BYTES + 1, stat.size + 1))
    let offset = 0
    while (offset < bytes.length) {
      const read = await file.read(bytes, offset, bytes.length - offset, null)
      if (!read.bytesRead) break
      offset += read.bytesRead
    }
    if (offset > stat.size) fail('input_changed', 'The source changed while it was read; retry the next snapshot.')
    let value
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset))) }
    catch { fail('invalid_json', 'The source is not a complete UTF-8 JSON snapshot.') }
    return { value, fingerprint: hash(bytes.subarray(0, offset)), modified: stat.mtimeMs }
  } finally { await file.close() }
}

export async function importFile(store, path, source, options) {
  store.validateSource(source)
  const input = await readInput(path)
  const totals = { inserted: 0, omitted: 0 }
  for (const batch of normalize(input.value)) {
    const result = store.ingest(source, batch, options)
    totals.inserted += result.inserted; totals.omitted += result.omitted
  }
  return totals
}

/** The collector never sends commands, changes capture policy, or reads a bearer. */
export async function collect(store, path, source, { includeContent = false, signal, intervalMs = 1000, once = false } = {}) {
  store.validateSource(source)
  let previous = null
  while (!signal?.aborted) {
    try {
      const input = await readInput(path)
      if (input.value?.format !== 'project-studio.inspector-feed') fail('invalid_feed', 'Use import for historical exports; collect reads the desktop Inspector feed.')
      if (Date.now() - input.modified > 15_000) { store.sourceFailure(source, 'feed_stale'); previous = null }
      else if (input.fingerprint !== previous) {
        for (const batch of normalize(input.value)) store.ingest(source, batch, { includeContent, liveCursor: true })
        previous = input.fingerprint
      }
    } catch (error) {
      previous = null
      const code = error instanceof InspectorError ? error.code : error?.code === 'ENOENT' ? 'feed_unavailable' : 'collector_io_failed'
      // No source cursor is acknowledged on failure; the next atomic snapshot retries.
      try { store.sourceFailure(source, code) } catch { /* Disk failure cannot affect Studio. */ }
      if (once) throw error
    }
    if (once) return
    try { await delay(intervalMs, undefined, { signal }) } catch { return }
  }
}
