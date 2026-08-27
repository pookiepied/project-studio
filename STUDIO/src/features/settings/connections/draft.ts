import type { LanguageProtocol } from '@/platform/harness'

/**
 * Turning what someone typed into what the harness will accept.
 *
 * ---- Two spellings of one list (FE-05) -------------------------------------
 *
 * `domain/models/types.ts` used to carry `COMPATIBILITIES`, four wire formats
 * written for the offline catalog; that catalog is gone, and with it the
 * second list. `platform/harness/contracts.ts` has `LANGUAGE_PROTOCOLS`, the
 * four the harness actually branches on, and they are the only spelling left:
 *
 *   openai-completions
 *   openai-responses
 *   anthropic-messages
 *   google-generative-ai
 *
 * No translation table is written here, and that is deliberate. A mapping
 * between two lists would be a fifth thing to keep in step. What gets SENT is
 * the harness union, full stop — this file names it directly.
 *
 * ---- Language only ---------------------------------------------------------
 *
 * The harness discriminates connections on `kind`: language, media, retrieval.
 * This dialog creates language connections and nothing else. Media has its own
 * protocols, its own probe shape and its own model semantics — the harness's
 * own model catalog returns no rows for a media connection yet — so a media
 * creation flow would be a form that produces a record nothing can use. That
 * is Task 17's business, not a `kind` dropdown bolted on here.
 */

/** The label beside each protocol. The id is what travels; this is not sent. */
export const LANGUAGE_PROTOCOL_CHOICES: readonly {
  readonly id: LanguageProtocol
  readonly name: string
}[] = [
  { id: 'openai-completions', name: 'OpenAI (chat completions)' },
  { id: 'openai-responses', name: 'OpenAI (responses)' },
  { id: 'anthropic-messages', name: 'Anthropic (messages)' },
  { id: 'google-generative-ai', name: 'Google (generateContent)' },
]

/**
 * Fails to compile if the harness adds a protocol and this list does not.
 *
 * The choices above are hand-ordered for the menu, so they cannot simply be
 * `LANGUAGE_PROTOCOLS.map(...)`. This is the guard that keeps the hand-written
 * list total: a fifth protocol on the harness makes the assignment below
 * incomplete and the build stops here rather than in front of a user staring
 * at a menu missing an option.
 */
const _everyProtocolIsOffered: Record<LanguageProtocol, true> = {
  'openai-completions': true,
  'openai-responses': true,
  'anthropic-messages': true,
  'google-generative-ai': true,
}
void _everyProtocolIsOffered

/**
 * The id the connection will be filed under, derived from its display name.
 *
 * The harness requires a slug — lowercase, digits, single hyphens, starting
 * and ending alphanumeric — because the id names a keychain entry of its own
 * and has to survive the credential store's validation unchanged. So it cannot
 * simply be the display name.
 *
 * Derived rather than asked for as a second field. Two name fields on a
 * four-field form is one too many, and the derived value is shown in the
 * dialog rather than hidden, because it is what a duplicate-id failure will
 * name back at you.
 *
 * Returns the empty string when nothing survives — a name of only punctuation
 * or only non-Latin characters. The caller treats that as "not valid yet"; it
 * is not a case to paper over with a random id, because an id nobody chose is
 * an id nobody can recognise in an error message.
 */
export function connectionIdFrom(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
