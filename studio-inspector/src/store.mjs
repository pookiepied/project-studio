import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fail, text } from './errors.mjs'
import { hash, redact } from './redact.mjs'

const VERSION = '1'
export const LIMITS = { events: 20_000, bytes: 32 * 1024 * 1024, eventBytes: 192 * 1024, days: 7 }

export class Store {
  constructor(path, { writable = false, limits = {} } = {}) {
    this.writable = writable
    this.limits = { ...LIMITS, ...limits }
    if (!writable && !existsSync(path)) fail('store_missing', 'Start the collector or import a recording before connecting Inspector.')
    if (writable) mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path, { readOnly: !writable })
    this.db.exec('PRAGMA busy_timeout=1500;')
    if (writable) {
      chmodSync(path, 0o600)
      this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; PRAGMA max_page_count=32768;
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, health TEXT NOT NULL, updated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS watermarks (source TEXT NOT NULL, boot TEXT NOT NULL, sequence INTEGER NOT NULL,
          updated INTEGER NOT NULL, PRIMARY KEY(source,boot));
        CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, conversation TEXT NOT NULL,
          first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, UNIQUE(source, conversation));
        CREATE TABLE IF NOT EXISTS payloads (id TEXT PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL,
          source TEXT NOT NULL, boot TEXT NOT NULL, capture TEXT NOT NULL, sequence INTEGER NOT NULL,
          session TEXT, conversation TEXT, submission TEXT, operation TEXT, attempt TEXT, parent TEXT,
          name TEXT NOT NULL, phase TEXT NOT NULL, outcome TEXT, time TEXT NOT NULL,
          received INTEGER NOT NULL, envelope TEXT NOT NULL, payload TEXT, bytes INTEGER NOT NULL,
          UNIQUE(source, boot, id));
        CREATE INDEX IF NOT EXISTS events_session ON events(session,cursor);
        CREATE INDEX IF NOT EXISTS events_operation ON events(session,operation,cursor);
        CREATE INDEX IF NOT EXISTS events_received ON events(received);`)
      this.db.prepare("INSERT OR IGNORE INTO meta VALUES ('version', ?)").run(VERSION)
    }
    if (this.db.prepare("SELECT value FROM meta WHERE key='version'").get()?.value !== VERSION) {
      this.db.close(); fail('unsupported_store', 'This Inspector store version is not supported.')
    }
  }

  close() { this.db.close() }
  validateSource(source) {
    if (!text(source, 100) || !/^[a-zA-Z0-9_.-]+$/.test(source)) fail('invalid_source', 'Choose a short source label containing letters, digits, dots, dashes or underscores.')
  }
  writeOnly() { if (!this.writable) fail('read_only', 'This connection only reads Inspector evidence.') }
  status(offset = 0, limit = 25, prefix = '') {
    const rows = this.db.prepare('SELECT id,health,updated FROM sources WHERE substr(id,1,?)=? ORDER BY id LIMIT ? OFFSET ?').all(prefix.length, prefix, limit + 1, offset)
    return { version: 1, retained: this.db.prepare('SELECT COUNT(*) count, COALESCE(SUM(bytes),0) bytes, MAX(cursor) cursor FROM events').get(),
      retentionRemoved: Number(this.db.prepare("SELECT value FROM meta WHERE key='retentionRemoved'").get()?.value ?? 0),
      nextOffset: rows.length > limit ? offset + limit : null,
      sources: rows.slice(0, limit).map((row) => {
        const value = JSON.parse(row.health); const source = value.sourceHealth ?? {}
        const receiptAgeMs = Math.max(0, Date.now() - row.updated)
        const collectorStatus = source.bridgeStatus && value.collectorStatus === 'reading' && receiptAgeMs > 15_000 ? 'collector_silent' : value.collectorStatus
        return { id: row.id, lastReceiptUnixMs: row.updated, receiptAgeMs, projected: true,
          health: { bootId: value.bootId, captureId: value.captureId, collectionMode: value.collectionMode, collectorStatus,
            gapObserved: value.gapObserved, omitted: value.omitted, lastSourceSequence: value.lastSourceSequence,
            sourceHealth: { bridgeStatus: source.bridgeStatus, nativeEvidence: source.nativeEvidence, inspectorOmission: source.inspectorOmission,
              feedId: source.feedId, snapshotId: source.snapshotId,
              writtenAtUnixMs: source.writtenAtUnixMs, latestSequence: source.latestSequence,
              droppedEvents: source.droppedEvents ?? source.dropped, evictedEvents: source.evictedEvents ?? source.evicted,
              retainedEvents: source.retainedEvents, retainedBytes: source.retainedBytes,
              recording: source.policy?.enabled, contentEnabled: source.policy?.captureContent } } }
      }) }
  }

  ingest(source, batch, { includeContent = false, liveCursor = false, now = Date.now() } = {}) {
    this.writeOnly()
    this.validateSource(source)
    const namespace = `${source}.${batch.namespace}`
    let inserted = 0; let omitted = 0
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const watermark = liveCursor ? this.db.prepare('SELECT sequence FROM watermarks WHERE source=? AND boot=?').get(namespace, batch.bootId)?.sequence ?? 0 : 0
      let highest = watermark
      for (const original of batch.events) {
        highest = Math.max(highest, original.sequence)
        if (liveCursor && original.sequence <= watermark) continue
        // Deduplication precedes session updates, so replays cannot look like new work.
        if (this.db.prepare('SELECT 1 FROM events WHERE source=? AND boot=? AND id=?').get(namespace, batch.bootId, original.eventId)) continue
        const event = redact(original)
        let content = includeContent && Object.hasOwn(event, 'content') ? JSON.stringify(event.content) : null
        delete event.content
        if (!includeContent && original.content !== undefined) { event.contentState = 'unavailable'; event.inspectorOmission = 'operator_content_disabled' }
        if (content && Buffer.byteLength(content) > 131_072) { content = null; event.contentState = 'truncated'; event.inspectorOmission = 'payload_limit'; omitted++ }
        const envelope = JSON.stringify(event)
        const bytes = Buffer.byteLength(envelope) + (content ? Buffer.byteLength(content) : 0)
        if (bytes > this.limits.eventBytes) { omitted++; continue }
        const identity = event.identity
        const conversation = text(identity.conversationId)
        let session = null
        if (conversation) {
          session = this.db.prepare('SELECT id FROM sessions WHERE source=? AND conversation=?').get(source, conversation)?.id ?? randomUUID()
          this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?) ON CONFLICT(source,conversation) DO UPDATE SET last_seen=excluded.last_seen').run(session, source, conversation, now, now)
        }
        const payload = content === null ? null : hash(content)
        if (payload) this.db.prepare('INSERT OR IGNORE INTO payloads VALUES (?,?)').run(payload, content)
        this.db.prepare(`INSERT INTO events (id,source,boot,capture,sequence,session,conversation,submission,operation,attempt,parent,name,phase,outcome,time,received,envelope,payload,bytes)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(event.eventId, namespace, batch.bootId, batch.captureId, event.sequence,
          session, conversation, text(identity.submissionId), text(identity.operationId), text(identity.attemptId), text(identity.parentOperationId),
          event.name, event.phase, event.outcome ?? null, event.timestamp, now, envelope, payload, bytes)
        inserted++
      }
      const previous = this.db.prepare('SELECT health FROM sources WHERE id=?').get(namespace)
      const old = previous ? JSON.parse(previous.health) : {}
      let sourceHealth = redact(batch.health ?? {})
      if (Buffer.byteLength(JSON.stringify(sourceHealth)) > 65_536) sourceHealth = { inspectorOmission: 'source_health_limit' }
      const health = redact({ sourceHealth, bootId: batch.bootId, captureId: batch.captureId,
        gapObserved: batch.gap || old.gapObserved === true, omitted: (old.omitted ?? 0) + omitted,
        lastSourceSequence: batch.events.at(-1)?.sequence ?? null,
        collectionMode: liveCursor ? 'live' : 'import', collectorStatus: liveCursor ? 'reading' : 'imported' })
      this.db.prepare('INSERT INTO sources VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET health=excluded.health, updated=excluded.updated').run(namespace, JSON.stringify(health), now)
      if (liveCursor) this.db.prepare('INSERT INTO watermarks VALUES (?,?,?,?) ON CONFLICT(source,boot) DO UPDATE SET sequence=MAX(sequence,excluded.sequence),updated=excluded.updated').run(namespace, batch.bootId, highest, now)
      this.prune(0, 0, now)
      this.db.exec('COMMIT')
      return { inserted, omitted }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  sourceFailure(source, code, now = Date.now()) {
    this.writeOnly()
    this.validateSource(source)
    const row = this.db.prepare('SELECT health FROM sources WHERE id=?').get(`${source}.harness`)
    const health = row ? JSON.parse(row.health) : {}
    health.collectorStatus = code
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO sources VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET health=excluded.health,updated=excluded.updated').run(`${source}.harness`, JSON.stringify(health), now)
      this.prune(0, 0, now)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  prune(reserveBytes, reserveEvents, now) {
    let removed = this.db.prepare('DELETE FROM events WHERE received < ?').run(now - this.limits.days * 86_400_000).changes
    const rows = this.db.prepare('SELECT cursor,bytes FROM events ORDER BY cursor').all()
    let count = rows.length + reserveEvents
    let bytes = rows.reduce((total, row) => total + row.bytes, reserveBytes)
    let through = null
    for (const row of rows) {
      if (count <= this.limits.events && bytes <= this.limits.bytes) break
      through = row.cursor; count--; bytes -= row.bytes
    }
    if (through !== null) removed += this.db.prepare('DELETE FROM events WHERE cursor<=?').run(through).changes
    this.db.prepare("INSERT INTO meta VALUES ('retentionRemoved',?) ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+CAST(excluded.value AS INTEGER) AS TEXT)").run(String(removed))
    this.db.prepare('DELETE FROM watermarks WHERE updated<?').run(now - this.limits.days * 86_400_000)
    this.db.exec('DELETE FROM payloads WHERE id NOT IN (SELECT payload FROM events WHERE payload IS NOT NULL); DELETE FROM sessions WHERE id NOT IN (SELECT session FROM events WHERE session IS NOT NULL);')
  }

  sessions(after = 0, limit = 25) {
    const rows = this.db.prepare('SELECT id,source,conversation,first_seen,last_seen,(SELECT MAX(cursor) FROM events WHERE session=sessions.id) last_cursor FROM sessions ORDER BY last_cursor DESC,id LIMIT ? OFFSET ?').all(limit + 1, after)
    return { sessions: rows.slice(0, limit), nextOffset: rows.length > limit ? after + limit : null }
  }
  session(id) {
    const row = this.db.prepare('SELECT id,source,conversation,first_seen,last_seen FROM sessions WHERE id=?').get(id)
    if (!row) fail('session_missing', 'This session is not in the retained Inspector window.')
    return row
  }

  timeline(session, { after = 0, limit = 50, operation, submission, source } = {}) {
    if (source) {
      if (!this.db.prepare('SELECT 1 FROM sources WHERE id=?').get(source)) fail('source_missing', 'Choose a retained source returned by get_inspector_status.')
    } else this.session(session)
    const clauses = [source ? 'source=?' : 'session=?', 'cursor>?']; const values = [source ?? session, after]
    if (operation) { clauses.push('operation=?'); values.push(operation) }
    if (submission) { clauses.push('submission=?'); values.push(submission) }
    const rows = this.db.prepare(`SELECT cursor,id,source,boot,capture,sequence,name,phase,outcome,time,operation,attempt,parent,submission,payload,envelope FROM events WHERE ${clauses.join(' AND ')} ORDER BY cursor LIMIT ?`).all(...values, limit + 1)
    const events = []
    let pageBytes = 0
    for (const row of rows.slice(0, limit)) {
      const envelope = JSON.parse(row.envelope)
      const { envelope: ignored, ...metadata } = row
      const attributes = Buffer.byteLength(JSON.stringify(envelope.attributes)) <= 4096 ? envelope.attributes : { inspectorOmission: 'attribute_page_limit' }
      const identityProjected = Buffer.byteLength(JSON.stringify(envelope.identity)) > 8192
      const identity = identityProjected ? Object.fromEntries(Object.entries(envelope.identity).slice(0, 24)) : envelope.identity
      const event = { ...metadata, identity, identityProjected, attributes, contentState: envelope.contentState }
      const bytes = Buffer.byteLength(JSON.stringify(event))
      if (pageBytes + bytes > 32_768 && events.length > 0) break
      events.push(event); pageBytes += bytes
    }
    const first = this.db.prepare('SELECT MIN(cursor) first FROM events').get().first
    return { events, nextCursor: events.at(-1)?.cursor ?? after, hasMore: rows.length > events.length,
      retentionGapPossible: after > 0 && first !== null && after < first - 1,
      coverage: { retainedOnly: true, contentIncluded: false, sourceClocksAreIndependent: true } }
  }

  readEvent(cursor, offset = 0, limit = 8000) {
    const row = this.db.prepare('SELECT envelope,payload FROM events WHERE cursor=?').get(cursor)
    if (!row) fail('event_missing', 'This event is outside the retained Inspector window.')
    return { ...this.textPage(row.envelope, offset, limit), cursor, payloadId: row.payload,
      provenance: 'captured-and-redacted-envelope', untrustedContent: true }
  }

  textPage(body, offset, limit) {
    if (offset > body.length || (offset > 0 && /[\uDC00-\uDFFF]/.test(body[offset] ?? ''))) fail('invalid_cursor', 'The payload cursor is outside a character boundary.')
    let end = Math.min(body.length, offset + limit)
    if (end < body.length && /[\uD800-\uDBFF]/.test(body[end - 1] ?? '')) end--
    return { encoding: 'json-text', offset, text: body.slice(offset, end),
      nextOffset: end < body.length ? end : null, totalCharacters: body.length }
  }

  payload(session, id, offset = 0, limit = 8000) {
    this.session(session)
    const row = this.db.prepare('SELECT body FROM payloads WHERE id=? AND EXISTS (SELECT 1 FROM events WHERE session=? AND payload=?)').get(id, session, id)
    if (!row) fail('payload_missing', 'This payload is unavailable, omitted or outside the retained session.')
    return { payloadId: id, ...this.textPage(row.body, offset, limit),
      provenance: 'captured-and-redacted-evidence', untrustedContent: true }
  }

  erase() {
    this.writeOnly()
    this.db.exec('BEGIN IMMEDIATE; DELETE FROM events; DELETE FROM payloads; DELETE FROM sessions; DELETE FROM sources; DELETE FROM watermarks; DELETE FROM meta WHERE key!=\'version\'; COMMIT; VACUUM;')
  }
}
