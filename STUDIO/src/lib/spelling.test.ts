import { describe, expect, it, vi } from 'vitest'
import aff from '@/assets/spelling/en.aff?raw'
import dic from '@/assets/spelling/en.dic?raw'
import { suggestionsFor, wordInField } from './spelling'

const caretIn = (value: string, needle: string, offset = 1) => {
  const at = value.indexOf(needle) + offset
  return wordInField(value, at, at)
}

describe('which word the menu corrects', () => {
  it('names the word around a bare caret', () => {
    expect(caretIn('an umbrela today', 'umbrela')?.word).toBe('umbrela')
    expect(caretIn('an umbrela today', 'umbrela', 7)?.word).toBe('umbrela')
  })

  it('names a selected word, even with the space a double-click brings', () => {
    const value = 'an umbrela today'
    const from = value.indexOf('umbrela')
    expect(wordInField(value, from, from + 8)?.word).toBe('umbrela')
  })

  it('leaves a selection of several words alone', () => {
    expect(wordInField('an umbrela today', 0, 10)).toBeNull()
  })

  it('leaves code, paths, addresses and acronyms alone', () => {
    for (const value of ['useState()', 'camelCase', 'src/main.rs', 'my_var', 'v2beta', 'HTTP', 'a@example.com', 'file.txt']) {
      expect(caretIn(value, value, 2)).toBeNull()
    }
  })

  it('leaves very short words alone', () => {
    expect(caretIn('go to it', 'to')).toBeNull()
  })

  it('keeps an apostrophe inside a word', () => {
    expect(caretIn("it doesnt matter, don't", "don't", 2)?.word).toBe("don't")
  })

  it('does not mistake part of a word for a spelling error', () => {
    expect(wordInField('umbrella', 0, 7)).toBeNull()
    expect(caretIn('caf\u00e9', 'caf')).toBeNull()
  })
})

it('retries a failed local dictionary load and uses the bundled English words', async () => {
  const fetchDictionary = vi.fn(async (url: string) => new Response(url.endsWith('.aff') ? aff : dic))
  fetchDictionary.mockImplementationOnce(async () => new Response(aff, { status: 503 }))
  vi.stubGlobal('fetch', fetchDictionary)
  try {
    expect(await suggestionsFor('umbrela')).toEqual([])
    expect(await suggestionsFor('umbrela')).toContain('umbrella')
    expect(await suggestionsFor('Umbrela')).toContain('Umbrella')
    expect(await suggestionsFor('umbrella')).toEqual([])
    expect(fetchDictionary).toHaveBeenCalledTimes(4)
  } finally {
    vi.unstubAllGlobals()
  }
})
