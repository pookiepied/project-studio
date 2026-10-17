import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { Store } from './store.mjs'
import { importFile, collect, readInput } from './collect.mjs'
import { serve } from './mcp.mjs'
import { query } from './queries.mjs'
import { InspectorError, fail } from './errors.mjs'

const HELP = `Studio Inspector V0 (Node 24.19+; no dependencies)
  node src/cli.mjs mcp [--store file]
  node src/cli.mjs collect --feed file [--source desktop] [--include-content] [--once]
  node src/cli.mjs import --input file [--source imported] [--include-content]
  node src/cli.mjs status | sessions | doctor
  node src/cli.mjs overview --session id
  node src/cli.mjs timeline --session id [--after cursor]
  node src/cli.mjs export --session id --output new-file [--include-content]
  node src/cli.mjs erase
All commands accept --store file. Capture is enabled only in Studio by its user.
MCP has no import, network, SQL, execution, capture-control or deletion tools.
`

function args(argv) {
  const command = argv[0] ?? 'help'; const options = {}
  const booleans = new Set(['include-content', 'once'])
  const values = new Set(['store', 'feed', 'source', 'input', 'session', 'after', 'output'])
  for (let index = 1; index < argv.length; index++) {
    const key = argv[index]?.slice(2)
    if (!argv[index]?.startsWith('--') || (!booleans.has(key) && !values.has(key)) || Object.hasOwn(options, key)) fail('invalid_argument', 'Use the documented CLI options once each.')
    if (booleans.has(key)) options[key] = true
    else {
      const value = argv[++index]
      if (!value || value.startsWith('--')) fail('invalid_argument', 'A CLI option is missing its value.')
      options[key] = value
    }
  }
  return { command, options }
}

async function main() {
  const { command, options } = args(process.argv.slice(2))
  if (command === 'help' || command === '--help') { process.stdout.write(HELP); return }
  const path = resolve(options.store ?? process.env.STUDIO_INSPECTOR_STORE ?? join(homedir(), '.studio-inspector', 'store.sqlite'))
  const controller = new AbortController()
  if (command === 'collect') {
    process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort())
  }
  if (command === 'mcp') {
    let store
    try { await serve(process.stdin, process.stdout, () => store ??= new Store(path)) }
    finally { store?.close() }
    return
  }
  if (command === 'doctor') {
    let store
    try {
      store = new Store(path)
      const feed = options.feed ? await readInput(resolve(options.feed)) : null
      process.stdout.write(`${JSON.stringify({ node: process.versions.node, store: 'readable',
        feed: feed ? { ageMs: Date.now() - feed.modified, format: feed.value.format, status: feed.value.status ?? 'export' } : 'not_checked', ...store.status() }, null, 2)}\n`)
    } finally { store?.close() }
    return
  }
  const writable = ['collect', 'import', 'erase', 'init'].includes(command)
  const store = new Store(path, { writable })
  let result
  try {
    switch (command) {
      case 'init': result = store.status(); break
      case 'collect':
        if (!options.feed) fail('invalid_argument', 'Copy the Inspector feed path from Studio Diagnostics and pass --feed.')
        await collect(store, resolve(options.feed), options.source ?? 'desktop', { includeContent: options['include-content'] === true, once: options.once === true, signal: controller.signal })
        result = store.status(); break
      case 'import':
        if (!options.input) fail('invalid_argument', 'Choose a Studio JSON export with --input.')
        result = await importFile(store, resolve(options.input), options.source ?? 'imported', { includeContent: options['include-content'] === true }); break
      case 'status': result = store.status(); break
      case 'sessions': result = await query(store, 'list_sessions'); break
      case 'overview': result = await query(store, 'get_session_overview', { sessionId: options.session }); break
      case 'timeline': result = await query(store, 'get_timeline', { sessionId: options.session, after: Number(options.after ?? 0) }); break
      case 'export': {
        if (!options.output || !options.session) fail('invalid_argument', 'Select --session and a new --output file.')
        const session = store.session(options.session)
        const rows = store.db.prepare('SELECT source,boot,capture,envelope,payload FROM events WHERE session=? ORDER BY cursor').all(session.id)
        const batches = new Map()
        for (const row of rows) {
          const key = JSON.stringify([row.source, row.boot, row.capture])
          if (!batches.has(key)) batches.set(key, { namespace: row.source.slice(session.source.length + 1), bootId: row.boot, captureId: row.capture,
            health: { provenance: 'inspector_export', sourceNamespace: row.source }, gap: true, events: [] })
          const event = JSON.parse(row.envelope)
          if (options['include-content'] && row.payload) event.content = JSON.parse(store.db.prepare('SELECT body FROM payloads WHERE id=?').get(row.payload).body)
          else if (row.payload) { event.contentState = 'unavailable'; event.inspectorOmission = 'export_content_disabled' }
          batches.get(key).events.push(event)
        }
        const body = JSON.stringify({ format: 'studio-inspector.archive', version: 1, exportedAt: new Date().toISOString(), session, batches: [...batches.values()] })
        if (Buffer.byteLength(body) > 48 * 1024 * 1024) fail('export_limit', 'This export exceeds the portable archive bound.')
        await writeFile(resolve(options.output), body, { flag: 'wx', mode: 0o600 })
        result = { exported: true, events: rows.length, contentIncluded: options['include-content'] === true }; break
      }
      case 'erase': store.erase(); result = { erased: true }; break
      default: fail('unknown_command', 'Use help to see supported Inspector commands.')
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } finally { store.close() }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ code: error instanceof InspectorError ? error.code : 'inspector_io_failed',
    message: error instanceof InspectorError ? error.message : 'Inspector could not complete this operation. Check local file access and storage.' })}\n`)
  process.exitCode = 1
})
