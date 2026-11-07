import type NSpell from 'nspell'
// The desktop webview allows same-origin fetches, so keep both files as assets.
import affUrl from '@/assets/spelling/en.aff?url&no-inline'
import dicUrl from '@/assets/spelling/en.dic?url&no-inline'

/**
 * Spelling help for the editing menu.
 *
 * The webview underlines a misspelled word but keeps its suggestions to its own
 * right-click menu, and that menu is blocked here (see `suppressWebviewChrome`),
 * so the app offers suggestions from a bundled English dictionary. The assets
 * load only when there is a word to check, and field text stays in the webview.
 *
 * Only a plain word. People type file names, identifiers, commands and
 * addresses into this app's fields all day, and a menu that offers to "fix"
 * `useState` or `src/main.rs` is worse than none. So anything with digits,
 * inner capitals, underscores or path/address punctuation beside it, anything
 * in capitals, and anything under three letters is left alone.
 */

export interface SpellingWord {
  word: string
  start: number
  end: number
}

const LETTER = /[A-Za-z]/
const WORD_EDGE = /[\p{L}\p{M}]/u
/** Characters that make a neighbouring word a name, path or address and not prose. */
const CODE_EDGE = /[0-9_/\\@#$%&=<>{}[\]:]/

export interface SpellingTarget {
  readonly word: SpellingWord
  readonly value: string
}

/** Capture the field at the context event, before the menu or dictionary opens. */
export function spellingTargetOf(field: HTMLTextAreaElement | HTMLInputElement): SpellingTarget | null {
  if (field.disabled || field.readOnly || field.spellcheck === false || field.getAttribute('spellcheck') === 'false') return null
  if (field instanceof HTMLInputElement && field.type === 'password') return null
  const { value, selectionStart, selectionEnd } = field
  if (selectionStart === null || selectionEnd === null) return null
  const word = wordInField(value, selectionStart, selectionEnd)
  return word === null ? null : { word, value }
}

/**
 * The word a field's selection names. A selection that is exactly one word names
 * it; a bare caret names the word it sits in or against. Null when there is no
 * word there, or the word is not prose.
 */
export function wordInField(value: string, from: number, to: number): SpellingWord | null {
  let start = from
  let end = to
  if (from === to) {
    while (start > 0 && isWordChar(value[start - 1])) start -= 1
    while (end < value.length && isWordChar(value[end])) end += 1
  } else {
    // A selection may carry the space that came with a double-click.
    while (start < end && !isWordChar(value[start])) start += 1
    while (end > start && !isWordChar(value[end - 1])) end -= 1
    if (value.slice(start, end).split(/\s/).length > 1) return null
  }

  while (start < end && !LETTER.test(value[start] ?? '')) start += 1
  while (end > start && !LETTER.test(value[end - 1] ?? '')) end -= 1
  const word = value.slice(start, end)
  if (word.length < 3 || !/^[A-Za-z]+(?:['’][A-Za-z]+)*$/.test(word)) return null
  // Capitals past the first letter: an acronym or camelCase, never a typo to fix.
  if (/[A-Z]/.test(word.slice(1))) return null
  const before = value[start - 1] ?? ''
  const after = value[end] ?? ''
  if (WORD_EDGE.test(before) || WORD_EDGE.test(after)) return null
  if ((isApostrophe(before) && WORD_EDGE.test(value[start - 2] ?? '')) ||
      (isApostrophe(after) && WORD_EDGE.test(value[end + 1] ?? ''))) return null
  if (CODE_EDGE.test(before) || CODE_EDGE.test(after)) return null
  // A dot with a letter on its far side: a file name or an address.
  if ((before === '.' && LETTER.test(value[start - 2] ?? '')) || (after === '.' && LETTER.test(value[end + 1] ?? ''))) return null
  return { word, start, end }
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && (LETTER.test(char) || isApostrophe(char))
}

function isApostrophe(char: string): boolean {
  return char === "'" || char === '\u2019'
}

async function readDictionaryAsset(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Spelling dictionary is unavailable')
  return response.text()
}

let checker: Promise<NSpell | null> | null = null

function load(): Promise<NSpell | null> {
  checker ??= (async () => {
    try {
      const [aff, dic, { default: nspell }] = await Promise.all([
        readDictionaryAsset(affUrl),
        readDictionaryAsset(dicUrl),
        import('nspell'),
      ])
      return nspell(aff, dic)
    } catch {
      // No dictionary is no suggestions, not a broken menu. Retried on the next right-click.
      checker = null
      return null
    }
  })()
  return checker
}

/** Suggestions for a word, or an empty list when it is spelled right or nothing is known. */
export async function suggestionsFor(word: string, limit = 3): Promise<string[]> {
  const spell = await load()
  if (spell === null) return []
  const normal = word.replace(/’/g, "'")
  if (spell.correct(normal)) return []
  // A sentence-start capital is not a misspelling of the lower-case word.
  if (/^[A-Z]/.test(normal) && spell.correct(normal.toLowerCase())) return []
  const found = spell.suggest(normal).slice(0, limit)
  // Keep the capital the person typed.
  return /^[A-Z]/.test(normal) ? found.map((item) => item.charAt(0).toUpperCase() + item.slice(1)) : found
}
