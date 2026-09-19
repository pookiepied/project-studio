/**
 * What a conversation's context measured at its last turn.
 */

/**
 * What the provider said one conversation's last request actually was.
 *
 * The four parts are what a prompt is billed in, and all four of the first
 * three occupy the window: `cacheRead` is prompt the provider served from its
 * own cache and `cacheWrite` is prompt it stored while reading, so a reader
 * that counts only `input` sees a fraction of the real prompt.
 */
export interface MeasuredContextUsage {
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
  readonly observedAt: number
  /**
   * The harness's provisional figure after a compaction, before any request
   * has measured the shortened conversation. Absent on the wire means false:
   * a row a harness wrote before the flag existed is a measurement.
   */
  readonly estimated: boolean
}

/**
 * Reads the measurement, or answers null.
 *
 * Null covers both "no turn has reported yet" and a body that does not carry
 * the shape - and the caller does the same thing for both, which is fall back
 * to its estimate. A partial body is refused rather than read as zeroes: a
 * measurement missing its cache parts would read as a window a fraction as
 * full as it is, which is exactly the failure this whole path exists to fix.
 */
export function parseMeasuredContextUsage(value: unknown): MeasuredContextUsage | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const usage = record['usage']
  if (typeof usage !== 'object' || usage === null) return null
  const parts = usage as Record<string, unknown>
  const number = (key: string): number | null => {
    const found = parts[key]
    return typeof found === 'number' && Number.isFinite(found) && found >= 0 ? found : null
  }
  const input = number('input')
  const cacheRead = number('cacheRead')
  const cacheWrite = number('cacheWrite')
  const output = number('output')
  const observedAt = number('observedAt')
  if (
    input === null ||
    cacheRead === null ||
    cacheWrite === null ||
    output === null ||
    observedAt === null
  ) {
    return null
  }
  return { input, cacheRead, cacheWrite, output, observedAt, estimated: parts['estimated'] === true }
}

/**
 * Whether the conversation may be compacted by hand right now, and if not,
 * the sentence the control shows. Null when the harness composed no manual
 * compaction, which the control reads as "not offered".
 */
export type CompactionReadiness =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string }

export function parseCompactionReadiness(value: unknown): CompactionReadiness | null {
  if (typeof value !== 'object' || value === null) return null
  const compact = (value as Record<string, unknown>)['compact']
  if (typeof compact !== 'object' || compact === null) return null
  const record = compact as Record<string, unknown>
  if (record['available'] === true) return { available: true }
  if (record['available'] === false && typeof record['reason'] === 'string') {
    return { available: false, reason: record['reason'] }
  }
  return null
}
