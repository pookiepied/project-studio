/**
 * The one narrowing every parser starts with.
 *
 * A wire payload, a command answer, an artifact body: each arrives as
 * `unknown`, and nothing may read a field off it until this has said it is
 * a plain object. Arrays are refused on purpose -- an array is also an
 * `object`, and a parser that accepted one would read `value['id']` off a
 * list and get `undefined` where it expected a refusal.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
