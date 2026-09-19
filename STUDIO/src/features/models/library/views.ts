import type { SurfaceMove } from '@/design/tokens'

/**
 * The library's pages, and how one hands over to the next.
 *
 * ---- What the levels are ---------------------------------------------------
 *
 * The library is the Connection -> Models -> Details hierarchy: the landing
 * names the connections, a connection's page lists its models, and a
 * model's page holds the facts. `search` is not a fourth level - it is the
 * same two levels seen through a needle, so it is its own page only so the
 * stage can tell results from a connection's list.
 *
 * ---- Why the pages move like routes ---------------------------------------
 *
 * `RULES.md` confines a page's own animation to a crossfade because the shell
 * is already playing a push or pop underneath it; two directional moves
 * compound into a hop. The library's drill-down is different in exactly one
 * way: nothing underneath is moving. The dialog frame fades in once and then
 * stands still, so the handover between its pages is the only motion in
 * flight - and a drill-in that crossfades throws away the one thing the
 * direction system exists to say. So these pages use the same push / pop /
 * sibling vocabulary the routes use, with the depths this hierarchy actually
 * has.
 */
export type LibraryView =
  | { readonly kind: 'connections' }
  | { readonly kind: 'connection'; readonly id: string }
  | { readonly kind: 'model'; readonly id: string }
  | { readonly kind: 'search' }

export const CONNECTIONS_VIEW: LibraryView = { kind: 'connections' }
export const SEARCH_VIEW: LibraryView = { kind: 'search' }

export function connectionView(id: string): LibraryView {
  return { kind: 'connection', id }
}

export function modelView(id: string): LibraryView {
  return { kind: 'model', id }
}

/** The key a page animates under: two pages with different content never share one. */
export function viewKey(view: LibraryView): string {
  switch (view.kind) {
    case 'connections':
      return 'connections'
    case 'connection':
      return `connection:${view.id}`
    case 'model':
      return `model:${view.id}`
    case 'search':
      return 'search'
  }
}

/** How deep a page sits, for classifying the move between two of them. */
const DEPTH = { connections: 0, connection: 1, model: 2 } as const

/**
 * The move between two pages: push drilling in, pop coming back, sibling for
 * anything lateral. Search is lateral to everything - it is a filter laid
 * over whichever page is under it, not a level of the hierarchy - and two
 * pages of one kind are siblings too: neither is above the other.
 */
export function viewMove(previous: LibraryView, next: LibraryView): SurfaceMove {
  if (previous.kind === 'search' || next.kind === 'search') return 'sibling'
  if (previous.kind === next.kind) return 'sibling'
  return DEPTH[next.kind] > DEPTH[previous.kind] ? 'push' : 'pop'
}

/**
 * The page the library's three inputs resolve to, in priority order. An open
 * model wins - it is what the reader is looking at, and it must survive the
 * search field still holding the needle that opened it. Then the search: a
 * needle turns whatever is underneath into results. Then the connection, and
 * finally the landing.
 */
export function viewOf(
  query: string,
  modelId: string | null,
  connectionId: string | null,
): LibraryView {
  if (modelId !== null) return modelView(modelId)
  if (query.trim() !== '') return SEARCH_VIEW
  if (connectionId !== null) return connectionView(connectionId)
  return CONNECTIONS_VIEW
}
