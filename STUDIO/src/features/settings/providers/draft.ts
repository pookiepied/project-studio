import type { LanguageProtocol } from '@/platform/harness'

/**
 * Turning what someone typed into what the harness will accept.
 *
 * `platform/harness/contracts/` has `LANGUAGE_PROTOCOLS`, the protocols the
 * harness actually branches on, and they are the only spelling left; what gets
 * SENT is the harness union, full stop. No translation table is written here,
 * and that is deliberate: a mapping between two lists would be another thing
 * to keep in step.
 *
 * ---- Language only ---------------------------------------------------------
 *
 * The harness discriminates connections on `kind`: language, media, retrieval.
 * The custom form creates language connections and nothing else. Media and
 * retrieval vendors come from the provider library, where the kind and
 * protocol are the harness's own answer rather than a dropdown the user has
 * to understand.
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
  { id: 'mistral-conversations', name: 'Mistral (conversations)' },
  { id: 'azure-openai-responses', name: 'Azure OpenAI (responses)' },
]

/**
 * Fails to compile if the harness adds a protocol and this list does not.
 *
 * The choices above are hand-ordered for the menu, so they cannot simply be
 * `LANGUAGE_PROTOCOLS.map(...)`. This is the guard that keeps the hand-written
 * list total: a new protocol on the harness makes the assignment below
 * incomplete and the build stops here rather than in front of a user staring
 * at a menu missing an option.
 */
const _everyProtocolIsOffered: Record<LanguageProtocol, true> = {
  'openai-completions': true,
  'openai-responses': true,
  'anthropic-messages': true,
  'google-generative-ai': true,
  'mistral-conversations': true,
  'azure-openai-responses': true,
}
void _everyProtocolIsOffered

/**
 * The id the connection will be filed under, derived from its display name.
 *
 * The harness requires a slug - lowercase, digits, single hyphens, starting
 * and ending alphanumeric - because the id names a keychain entry of its own
 * and has to survive the credential store's validation unchanged. So it cannot
 * simply be the display name.
 *
 * Derived rather than asked for as a second field. Two name fields on a
 * four-field form is one too many, and the derived value is shown in the
 * dialog rather than hidden, because it is what a duplicate-id failure will
 * name back at you.
 *
 * Returns the empty string when nothing survives - a name of only punctuation
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
