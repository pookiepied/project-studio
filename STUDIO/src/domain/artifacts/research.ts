import type { Artifact, ArtifactStatus } from '@/domain/artifacts/types'
import { isRecord } from '@/lib/guards'

/**
 * What a research artifact says: the steps a model took on the web.
 *
 * A search is a query and the sources it found; a read is one page and
 * what it said. A turn that runs three searches at once and then reads two
 * of the results is one piece of research, not five rows, so the artifact
 * holds a list of steps in the order they were asked for, each with its
 * own state - which is what lets three parallel searches show as three
 * pulsing dots and settle one at a time.
 *
 * Two writers fill the field. A fence (the gallery's, or a model's) spells
 * one finished search as a `links` section and a `query`; the transcript
 * spells every call as a step under `data.steps`. Both fold to steps here.
 */

export interface ResearchHit {
  readonly title: string
  readonly url: string
  readonly snippet?: string
}

interface StepBase {
  readonly id: string
  readonly status: ArtifactStatus
  /** Which service answered, in its own name. */
  readonly provider?: string
  /** The service that was asked first and could not answer, and why. */
  readonly fellBack?: string
  /** Why the step failed, in the harness's words. */
  readonly error?: string
}

export interface SearchStep extends StepBase {
  readonly kind: 'search'
  readonly query: string
  readonly hits: readonly ResearchHit[]
  /** The provider's own one-paragraph answer, when it wrote one. */
  readonly summary?: string
}

export interface ReadStep extends StepBase {
  readonly kind: 'read'
  readonly url: string
  /** The page's own title, once read. */
  readonly title?: string
  /** The opening of the page's text. */
  readonly excerpt?: string
}

export type ResearchStep = SearchStep | ReadStep

const STATUSES: ReadonlySet<string> = new Set(['pending', 'running', 'done', 'failed', 'cancelled'])

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function statusOf(value: unknown, fallback: ArtifactStatus): ArtifactStatus {
  return typeof value === 'string' && STATUSES.has(value) ? (value as ArtifactStatus) : fallback
}

function hitOf(value: unknown): ResearchHit | null {
  if (!isRecord(value)) return null
  const url = text(value['url']) ?? text(value['href'])
  if (url === undefined) return null
  const snippet = text(value['snippet']) ?? text(value['description'])
  return {
    title: text(value['title']) ?? text(value['label']) ?? url,
    url,
    ...(snippet === undefined ? {} : { snippet }),
  }
}

function base(value: Record<string, unknown>, index: number, fallback: ArtifactStatus): StepBase {
  const provider = text(value['provider'])
  const fellBack = text(value['fellBack'])
  const error = text(value['error'])
  return {
    id: text(value['id']) ?? `step-${String(index)}`,
    status: statusOf(value['status'], fallback),
    ...(provider === undefined ? {} : { provider }),
    ...(fellBack === undefined ? {} : { fellBack }),
    ...(error === undefined ? {} : { error }),
  }
}

function stepOf(value: unknown, index: number, fallback: ArtifactStatus): ResearchStep | null {
  if (!isRecord(value)) return null
  if (value['kind'] === 'search') {
    const query = text(value['query'])
    if (query === undefined) return null
    const summary = text(value['summary'])
    const hits = Array.isArray(value['hits'])
      ? value['hits'].flatMap((hit) => {
          const read = hitOf(hit)
          return read === null ? [] : [read]
        })
      : []
    return { ...base(value, index, fallback), kind: 'search', query, hits, ...(summary === undefined ? {} : { summary }) }
  }
  if (value['kind'] === 'read') {
    const url = text(value['url'])
    if (url === undefined) return null
    const title = text(value['title'])
    const excerpt = text(value['excerpt'])
    return {
      ...base(value, index, fallback),
      kind: 'read',
      url,
      ...(title === undefined ? {} : { title }),
      ...(excerpt === undefined ? {} : { excerpt }),
    }
  }
  return null
}

/**
 * The steps, from `data.steps` when the artifact carries them, or one
 * search step assembled from a fence's `query` and `links` section.
 */
export function researchOf(artifact: Artifact): readonly ResearchStep[] {
  const data = artifact.data ?? {}
  const listed = Array.isArray(data['steps'])
    ? data['steps'].flatMap((step, index) => {
        const read = stepOf(step, index, artifact.status)
        return read === null ? [] : [read]
      })
    : []
  if (listed.length > 0) return listed

  const links = artifact.sections?.find((section) => section.type === 'links')
  const hits: ResearchHit[] =
    links?.type === 'links'
      ? links.items.map((item) => ({
          title: item.label,
          url: item.href,
          ...(item.description === undefined ? {} : { snippet: item.description }),
        }))
      : []
  const provider = artifact.source?.server
  return [
    {
      kind: 'search',
      id: `${artifact.id}-search`,
      status: artifact.status,
      query: text(data['query']) ?? artifact.title,
      hits,
      ...(provider === undefined ? {} : { provider }),
    },
  ]
}
