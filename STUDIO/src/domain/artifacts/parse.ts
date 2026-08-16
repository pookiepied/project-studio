import type { Artifact, ArtifactSection, ArtifactStatus } from '@/domain/artifacts/types'

/**
 * Turning the text inside an ```artifact fence into an artifact.
 *
 * The input is model output, which means it is untrusted and frequently
 * half-written: this parser runs on every frame of a stream, so most of the
 * time it is handed a truncated JSON document that is not valid yet. That is
 * the normal case, not the error case, and it must be silent -- an error
 * message that flickers in the transcript for two seconds while an artifact
 * streams in is worse than showing nothing.
 *
 * So there are three outcomes and the caller can tell them apart:
 *
 *   `artifact`   parsed and usable
 *   `pending`    not valid JSON yet, and plausibly still arriving
 *   `error`      valid JSON that is not a usable artifact
 *
 * Only the third is worth telling anyone about, because only the third will
 * still be wrong when the stream finishes.
 */

export type ParseResult =
  | { readonly kind: 'artifact'; readonly artifact: Artifact }
  | { readonly kind: 'pending' }
  | { readonly kind: 'error'; readonly message: string }

/**
 * Wire spellings folded to the five real states.
 *
 * The gateway, the connectors and three generations of this app all named
 * these differently. Accepting every spelling here is what keeps the aliases
 * out of every renderer -- see the note in `types.ts`.
 */
const STATUS_ALIASES: Readonly<Record<string, ArtifactStatus>> = {
  pending: 'pending',
  queued: 'pending',
  loading: 'running',
  streaming: 'running',
  running: 'running',
  in_progress: 'running',
  done: 'done',
  completed: 'done',
  complete: 'done',
  success: 'done',
  succeeded: 'done',
  partial: 'done',
  failed: 'failed',
  error: 'failed',
  rejected: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
}

const SECTION_TYPES = new Set([
  'text',
  'stats',
  'list',
  'links',
  'table',
  'timeline',
  'file_changes',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/**
 * Keep the sections that are well formed and drop the rest.
 *
 * Dropping rather than failing is deliberate. One malformed section in an
 * artifact carrying five should cost you that section, not the artifact -- and
 * during a stream, the last section is *always* malformed for a moment.
 */
function sectionsOf(value: unknown): readonly ArtifactSection[] | undefined {
  if (!Array.isArray(value)) return undefined

  const sections = value.filter(
    (section): section is ArtifactSection =>
      isRecord(section) && typeof section.type === 'string' && SECTION_TYPES.has(section.type),
  )

  return sections.length > 0 ? sections : undefined
}

/**
 * Does this look like the start of a JSON document that is still arriving?
 *
 * Used to choose between `pending` and `error`, and it has to be right, because
 * getting it wrong the optimistic way means a red error card flashing in the
 * transcript every time an artifact streams.
 *
 * The cheap version -- starts with `{`, does not end with `}` -- is wrong, and
 * wrong specifically on pretty-printed JSON, which is what a model emits. Any
 * prefix that happens to stop just after a *nested* object closes ends with `}`
 * and reads as complete. In a document with one nested section that is a dozen
 * prefixes reported as broken while they were merely unfinished.
 *
 * So the nesting is actually counted, with a string scanner, because a brace
 * inside a string value is not structure -- and prompts contain braces. Depth
 * above zero, or ending mid-string, means more is coming.
 */
function looksTruncated(source: string): boolean {
  const trimmed = source.trim()
  if (trimmed.length === 0) return true
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false

  let depth = 0
  let inString = false
  let escaped = false

  for (const character of trimmed) {
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{' || character === '[') depth += 1
    else if (character === '}' || character === ']') depth -= 1
  }

  // A trailing backslash is an escape whose character has not arrived, which is
  // as unfinished as an open brace.
  return depth > 0 || inString || escaped
}

export function parseArtifact(source: string): ParseResult {
  let decoded: unknown
  try {
    decoded = JSON.parse(source)
  } catch {
    return looksTruncated(source)
      ? { kind: 'pending' }
      : { kind: 'error', message: 'This artifact is not valid JSON.' }
  }

  if (!isRecord(decoded)) return { kind: 'error', message: 'An artifact must be an object.' }

  const kind = text(decoded.kind)
  const title = text(decoded.title)

  // Absent during a stream, because JSON.parse only succeeds once the braces
  // balance but the fields may still be arriving in a nested object. Treated as
  // pending rather than broken for the same reason as above.
  if (!kind || !title) return { kind: 'pending' }

  const rawStatus = typeof decoded.status === 'string' ? decoded.status : 'done'

  return {
    kind: 'artifact',
    artifact: {
      kind,
      title,
      // Unknown spellings mean running, not broken. An artifact whose status we
      // do not recognise is more likely new than wrong, and "still going" is
      // the reading that resolves itself when the next frame arrives.
      status: STATUS_ALIASES[rawStatus] ?? 'running',
      // Stable across frames so React does not remount a streaming artifact.
      // Falling back to the title rather than to a random id matters: a random
      // one would change on every parse, which is every frame.
      id: text(decoded.id) ?? `${kind}:${title}`,
      summary: text(decoded.summary),
      source: isRecord(decoded.source)
        ? {
            server: text(decoded.source.server),
            tool: text(decoded.source.tool),
            callId: text(decoded.source.callId),
          }
        : undefined,
      stats: Array.isArray(decoded.stats)
        ? decoded.stats.filter(
            (stat): stat is { label: string; value: string | number } =>
              isRecord(stat) &&
              typeof stat.label === 'string' &&
              (typeof stat.value === 'string' || typeof stat.value === 'number'),
          )
        : undefined,
      sections: sectionsOf(decoded.sections),
      data: isRecord(decoded.data) ? decoded.data : undefined,
      expandable: decoded.expandable === true,
    },
  }
}
