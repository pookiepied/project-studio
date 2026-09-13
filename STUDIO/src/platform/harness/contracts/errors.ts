/**
 * What the harness sends with a failure, in both of the shapes it uses.
 */

import { isRecord } from '@/lib/guards'
import { optionalText, text } from './guards'

/**
 * What the harness sends with a failure. Two shapes share this reader:
 *
 * - OUR refusals: `{ error, code? }` from `failure()` in the provider routes,
 *   from the admission middleware, and from the turn-settings middleware -
 *   a flat sentence, `code` present when the route names a class.
 * - Flue's own refusals: the nested envelope `{ error: { type, message,
 *   details, ref? } }`, where `message` is the class sentence ("Request is
 *   malformed.") and `details` is the reason a person can act on. One of the
 *   two is always present on a Flue-authored refusal; `ref` is a server-log
 *   correlation id and is deliberately not carried.
 *
 * `error` is always the sentence to show a person: the flat shape's own line,
 * or the nested envelope's `details` falling back to `message`. A 400 that
 * used to render as "the harness answered 400 with no explanation" now names
 * what was wrong.
 */
export interface HarnessErrorBody {
  readonly error: string
  readonly code?: string
}

/**
 * The harness's failure body.
 *
 * Unlike the parsers above this one is allowed to fail softly: a body that
 * does not match still arrived with a status code the client must report, so
 * an unreadable error yields `null` and the caller substitutes a message of
 * its own rather than losing the failure entirely.
 */
export function parseHarnessErrorBody(value: unknown): HarnessErrorBody | null {
  if (!isRecord(value)) return null
  const code = optionalText(value['code'])
  const withCode = (error: string): HarnessErrorBody =>
    code.ok && code.value !== undefined ? { error, code: code.value } : { error }
  // Our flat shape first: `error` is the sentence itself.
  const flat = text(value['error'])
  if (flat !== null) return withCode(flat)
  // Flue's nested envelope: the sentence lives inside the error object, and
  // the specific reason (`details`) outranks the class sentence (`message`)
  // because "Request is malformed." is not something a person can act on.
  const nested = value['error']
  if (!isRecord(nested)) return null
  const sentence = text(nested['details']) ?? text(nested['message'])
  if (sentence === null) return null
  return withCode(sentence)
}
