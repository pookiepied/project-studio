/**
 * The primitive readers every parser is built from. Each answers null for a
 * value that is not the thing asked for, so a parser can refuse a body by
 * checking its parts.
 */

/**
 * Membership as a narrowing, without a cast.
 *
 * Comparing each allowed member against the value means the returned item is
 * already typed as the member — the alternative, `allowed.includes(value)`
 * followed by `value as T`, is the cast this codebase does not take.
 */
export function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  for (const item of allowed) if (item === value) return item
  return null
}

/** A non-empty string, which is what every `minLength(1)` on the harness means. */
export function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * A string field whose emptiness is a value, not an absence. The commands'
 * argument hint reads as "" when there is nothing to type, and so does every
 * field of a command file's frontmatter, which the harness always writes —
 * both keys, even when they are empty — so a plain `text` would refuse what
 * the harness legitimately sends.
 */
export function textOrEmpty(value: unknown): string | null {
  return value === '' ? '' : text(value)
}

/** An optional non-empty string: absent is fine, present but wrong is not. */
export function optionalText(value: unknown): { ok: true; value?: string } | { ok: false } {
  if (value === undefined) return { ok: true }
  const parsed = text(value)
  return parsed === null ? { ok: false } : { ok: true, value: parsed }
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The harness writes an undescribed number as the literal "unknown". */
export function numberOrUnknown(value: unknown): number | 'unknown' | null {
  if (value === 'unknown') return 'unknown'
  return finiteNumber(value)
}

export function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** Maps a parser over an array, failing the whole list if any element fails. */
export function listOf<T>(parse: (value: unknown) => T | null, value: unknown): readonly T[] | null {
  if (!Array.isArray(value)) return null
  const out: T[] = []
  for (const item of value) {
    const parsed = parse(item)
    if (parsed === null) return null
    out.push(parsed)
  }
  return out
}

export function nullableText(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null }
  const parsed = text(value)
  return parsed === null ? { ok: false } : { ok: true, value: parsed }
}

/**
 * A nullable text field the wire may drop entirely. `JSON.stringify` never
 * carries an `undefined`, so a request the harness built with `resource:
 * undefined` arrives with no `resource` key at all - and "no key" is the
 * same fact as null here, not a contract break.
 */
export function nullableTextOrAbsent(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined) return { ok: true, value: null }
  return nullableText(value)
}
