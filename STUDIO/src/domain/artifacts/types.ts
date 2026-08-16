/**
 * The artifact envelope.
 *
 * An artifact is a structured thing the model produced -- a search it ran, an
 * image it made, an issue it opened -- emitted as JSON in a fenced block and
 * rendered as an object rather than as prose. The envelope is a *contract*, so
 * it lives in `domain` beside the other contracts and not next to the
 * components that happen to draw it today.
 *
 * Two properties make it worth having a contract at all:
 *
 *   1. An unknown `kind` still renders. Every artifact may carry generic
 *      `sections`, so a renderer we have not written yet degrades to a
 *      readable card instead of an error or a blank.
 *   2. Nothing here is required except the four fields that make it
 *      identifiable. Everything a particular renderer wants lives in `data` or
 *      in sections, so adding a kind never changes this file.
 *
 * ---- Status, and why there are five of them ------------------------------
 *
 * The vocabulary this grew out of had eleven: `completed` and `success`,
 * `failed` and `error`, `loading` and `streaming` and `pending`. They were
 * synonyms, and the cost landed in every renderer -- each one wrote
 * `status === "completed" || status === "success"`, and each one had a
 * slightly different opinion about which of the eleven meant "still going".
 * One of them treated `error` as finished-and-fine.
 *
 * So the wire may say any of those and the parser folds them down to five,
 * once, at the boundary. A renderer asks one question and gets one answer.
 */

export type ArtifactStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface ArtifactStat {
  readonly label: string
  readonly value: string | number
}

export interface ArtifactLink {
  readonly label: string
  readonly href: string
  readonly description?: string
}

interface ArtifactListItem {
  readonly label?: string
  readonly value?: string | number
  readonly description?: string
  readonly href?: string
  readonly status?: ArtifactStatus
}

export interface ArtifactTimelineItem {
  readonly label: string
  readonly time?: string
  readonly description?: string
  readonly status?: ArtifactStatus
}

export interface ArtifactFileChange {
  readonly path: string
  readonly action?: 'created' | 'updated' | 'deleted' | 'renamed' | 'read'
  readonly additions?: number
  readonly deletions?: number
}

interface ArtifactTable {
  readonly columns: readonly string[]
  readonly rows: readonly (readonly (string | number | null)[])[]
}

/**
 * A generic piece of an artifact.
 *
 * These exist so an unrecognised kind is still worth looking at. A dedicated
 * renderer is free to ignore them and read `data` instead -- most do, for the
 * parts that are particular to it -- but anything it does not draw itself can
 * be expressed here and will be drawn by the fallback.
 */
export type ArtifactSection =
  | { readonly type: 'text'; readonly title?: string; readonly content: string }
  | { readonly type: 'stats'; readonly title?: string; readonly items: readonly ArtifactStat[] }
  | { readonly type: 'list'; readonly title?: string; readonly items: readonly ArtifactListItem[] }
  | { readonly type: 'links'; readonly title?: string; readonly items: readonly ArtifactLink[] }
  | { readonly type: 'table'; readonly title?: string; readonly table: ArtifactTable }
  | {
      readonly type: 'timeline'
      readonly title?: string
      readonly items: readonly ArtifactTimelineItem[]
    }
  | {
      readonly type: 'file_changes'
      readonly title?: string
      readonly items: readonly ArtifactFileChange[]
    }

interface ArtifactSource {
  /** The MCP server or connector this came through, in words a person uses. */
  readonly server?: string
  /** The raw tool name. Kept for support, never shown as a label. */
  readonly tool?: string
  readonly callId?: string
}

export interface Artifact {
  readonly kind: string
  readonly title: string
  readonly status: ArtifactStatus
  readonly id: string
  readonly summary?: string
  readonly source?: ArtifactSource
  readonly stats?: readonly ArtifactStat[]
  readonly sections?: readonly ArtifactSection[]
  /** Whatever this kind's own renderer needs. Opaque to everything else. */
  readonly data?: Record<string, unknown>
  /** This artifact is large enough to deserve the side rail. */
  readonly expandable?: boolean
}

/** Still working. The one question renderers actually ask about status. */
export function isWorking(status: ArtifactStatus): boolean {
  return status === 'pending' || status === 'running'
}
