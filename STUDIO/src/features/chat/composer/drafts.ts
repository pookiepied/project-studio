import { load } from '@tauri-apps/plugin-store'
import { isTauri } from '@/platform/tauri'

/**
 * Unsent composer text, kept across quits.
 *
 * A half-written message is work. Today it lives in one `useState` inside
 * `Composer` and is gone the moment the window closes, so quitting the app
 * mid-sentence destroys something the person meant to keep — silently, and
 * with no way to get it back.
 *
 * **Why a separate file from `preferences.json`.** Preferences are a handful
 * of values a person changes deliberately, a few times a year. Drafts are
 * volatile, unbounded in number, and written while someone types. Putting
 * them in the same file would mean rewriting the preferences on every
 * keystroke, and a crash mid-write would take the theme down with the draft.
 * Two files, two lifetimes.
 *
 * **Why not `localStorage`.** The same reason `appearance.ts` gives: it is
 * webview cache, wiped by anything that clears site data, and invisible to
 * the person whose sentence it is holding. It stays as the `pnpm dev`
 * fallback only, where there is no Tauri and therefore no file.
 */
const STORE_FILE = 'drafts.json'

/** The key a draft is filed under before the conversation exists. */
const NEW_CONVERSATION = 'new'

/**
 * How long the field must be still before a draft is written.
 *
 * Long enough that ordinary typing produces one write per pause rather than
 * one per character; short enough that the gap between the last keystroke
 * and a quit is not where the text goes missing. A flush on hide closes the
 * rest of that gap.
 */
const QUIET_MS = 400

/** The number of conversations that may hold a draft before the oldest go. */
const MAX_DRAFTS = 50

interface DraftRecord {
  readonly text: string
  /** Epoch milliseconds, so the eviction below has something to sort on. */
  readonly at: number
}

type DraftMap = Record<string, DraftRecord>

/** Resolves once, so a keystroke does not reopen the file. */
let storePromise: Promise<Awaited<ReturnType<typeof load>> | null> | null = null

async function openStore() {
  if (!isTauri()) return null
  storePromise ??= load(STORE_FILE, { autoSave: false }).catch(() => null)
  return storePromise
}

/**
 * The in-memory copy, and the reason reads are synchronous.
 *
 * `Composer` needs its initial value during the first render — an async read
 * would mount the field empty and then fill it, which looks like the app
 * losing the draft and then changing its mind. So the whole map is loaded
 * once at startup and every read after that is a lookup.
 */
let cache: DraftMap = {}
let loaded = false

/**
 * Loads every draft into memory. Call once, before the first composer mounts.
 *
 * Failure is not an error worth showing anyone: a draft that cannot be read
 * is a draft that was not there, which is exactly where the app was before
 * this file existed.
 */
export async function primeDrafts(): Promise<void> {
  if (loaded) return
  loaded = true
  const store = await openStore()
  if (store) {
    const stored = await store.get('drafts').catch(() => undefined)
    cache = coerce(stored)
    return
  }
  try {
    cache = coerce(JSON.parse(localStorage.getItem(STORE_FILE) ?? 'null'))
  } catch {
    cache = {}
  }
}

/** The draft for a conversation, or the empty string. Never throws. */
export function readDraft(conversationId: string | null): string {
  return cache[conversationId ?? NEW_CONVERSATION]?.text ?? ''
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Records a draft, writing it out once the typing stops.
 *
 * The in-memory copy updates immediately so a read is never behind the
 * field; only the file write waits. Empty text deletes rather than storing
 * a blank, so a conversation someone cleared does not sit in the file
 * forever pretending to hold something.
 */
export function writeDraft(conversationId: string | null, text: string): void {
  const key = conversationId ?? NEW_CONVERSATION
  if (text.length === 0) delete cache[key]
  else cache[key] = { text, at: Date.now() }

  const pending = timers.get(key)
  if (pending !== undefined) clearTimeout(pending)
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      void flushDrafts()
    }, QUIET_MS),
  )
}

/**
 * Forgets a conversation's draft immediately, without waiting for the timer.
 *
 * This is the send path. A message that left has no draft, and the write has
 * to be prompt: the alternative is a quit inside the quiet window restoring
 * text the person already sent, which reads as the app duplicating their
 * message.
 */
export function clearDraft(conversationId: string | null): void {
  const key = conversationId ?? NEW_CONVERSATION
  const pending = timers.get(key)
  if (pending !== undefined) {
    clearTimeout(pending)
    timers.delete(key)
  }
  if (!(key in cache)) return
  delete cache[key]
  void flushDrafts()
}

/**
 * Writes the map out now.
 *
 * Exported because a debounce is a bet that the process survives another
 * 400 ms, and a window being hidden is the moment that bet is worst. The
 * caller that knows the app is going away calls this.
 */
export async function flushDrafts(): Promise<void> {
  evict()
  const store = await openStore()
  if (store) {
    await store.set('drafts', cache).catch(() => undefined)
    await store.save().catch(() => undefined)
    return
  }
  try {
    localStorage.setItem(STORE_FILE, JSON.stringify(cache))
  } catch {
    /* storage unavailable — the draft stays in memory for this session */
  }
}

/**
 * Keeps the file bounded.
 *
 * Drafts accumulate: a conversation someone typed into and abandoned holds
 * its text indefinitely, and there is no event that ever cleans it up. Fifty
 * is far more than anyone has half-written at once, and dropping the oldest
 * first means the ones being evicted are the ones nobody has looked at.
 */
function evict(): void {
  const keys = Object.keys(cache)
  if (keys.length <= MAX_DRAFTS) return
  const oldestFirst = keys.sort((a, b) => (cache[a]?.at ?? 0) - (cache[b]?.at ?? 0))
  for (const key of oldestFirst.slice(0, keys.length - MAX_DRAFTS)) delete cache[key]
}

/**
 * Field by field, because a stored blob is untrusted input.
 *
 * The file can be hand-edited, can be left over from an older shape of this
 * record, or can be truncated by a crash mid-write. Anything that is not a
 * draft-shaped entry is dropped rather than reaching the composer, where a
 * non-string would be handed to a controlled input.
 */
function coerce(stored: unknown): DraftMap {
  if (typeof stored !== 'object' || stored === null) return {}
  const out: DraftMap = {}
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value !== 'object' || value === null) continue
    const record: Record<string, unknown> = { ...value }
    const text = record.text
    const at = record.at
    if (typeof text !== 'string' || text.length === 0) continue
    out[key] = { text, at: typeof at === 'number' ? at : 0 }
  }
  return out
}
