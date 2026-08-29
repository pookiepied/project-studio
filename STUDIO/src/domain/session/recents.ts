/**
 * The models a user actually chose, most recent first.
 *
 * ---- Why this exists, and why it is not "auto" -----------------------------
 *
 * Studio is not a first-party client of any provider, so it cannot honestly
 * invent a default model - what model a new conversation rides is the
 * harness's own default, shown as "Studio default", until the user names one.
 * What we can do is remember the names the user has already chosen and put
 * them one click away, so that from the second session onward the picker is
 * three rows instead of a library.
 *
 * ---- Why it lives here and not in the harness ------------------------------
 *
 * This is a convenience of one machine's interface, not a fact about
 * providers: the harness's provider store is where provider truth lives
 * ("one place a provider lives"), and a shortcuts list has no business there.
 * So it persists in this webview's localStorage, degrades to empty when
 * storage is unavailable or corrupt, and holds only what a pick proves -
 * model ids, resolved against the live catalog at read time, so a model that
 * has since been removed simply stops appearing rather than erroring.
 */

const KEY = 'studio.recent-models'

/** Three, deliberately: enough to cover a working week's rotation, small
 * enough that the section stays a shortcut rather than becoming a second
 * library. */
const LIMIT = 3

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    // Some privacy modes throw on mere access. A shortcuts list is not worth
    // an error surface; an empty list is the whole story.
    return undefined
  }
}

/** The remembered picks, most recent first, capped, tolerating anything. */
export function loadRecentModelIds(): string[] {
  const store = storage()
  if (store === undefined) return []
  try {
    const raw = store.getItem(KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .slice(0, LIMIT)
  } catch {
    return []
  }
}

/** Records one explicit pick and returns the new list, most recent first. */
export function rememberRecentModel(id: string): string[] {
  const next = [id, ...loadRecentModelIds().filter((entry) => entry !== id)].slice(0, LIMIT)
  const store = storage()
  if (store !== undefined) {
    try {
      store.setItem(KEY, JSON.stringify(next))
    } catch {
      // Unwritable storage cannot block a pick; the list just does not survive
      // the session.
    }
  }
  return next
}
