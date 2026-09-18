import { describe, expect, it } from 'vitest'

import { FIRST_PASSAGE_CHARS, PASSAGE_CHARS, splitPassages } from './passages'

/**
 * The cut between read-aloud requests. What is pinned: the opening passage
 * is short and every later one may be long; a cut lands at a sentence end,
 * never inside one, while a sentence fits; and nothing is lost or
 * duplicated across the cuts, however the text is shaped.
 */

const sentence = (n: number): string => `Sentence number ${String(n)} says a few words.`

function paragraph(count: number): string {
  return Array.from({ length: count }, (_, index) => sentence(index + 1)).join(' ')
}

describe('splitPassages', () => {
  it('keeps a short message as one passage', () => {
    expect(splitPassages('Good morning.')).toEqual(['Good morning.'])
  })

  it('answers nothing for a message that is only whitespace', () => {
    expect(splitPassages('  \n\n ')).toEqual([])
  })

  it('cuts the opening passage short and the rest long', () => {
    const passages = splitPassages(paragraph(60))
    expect(passages.length).toBeGreaterThan(2)
    expect(passages[0]?.length).toBeLessThanOrEqual(FIRST_PASSAGE_CHARS)
    // The opening passage is as full as the ceiling allows, not one sentence.
    expect(passages[0]?.length).toBeGreaterThan(FIRST_PASSAGE_CHARS / 2)
    for (const passage of passages.slice(1)) {
      expect(passage.length).toBeLessThanOrEqual(PASSAGE_CHARS)
    }
    expect(passages[1]?.length).toBeGreaterThan(FIRST_PASSAGE_CHARS)
  })

  it('sizes a sentence the opening passage refuses to the passage it opens', () => {
    const second = `${'b'.repeat(PASSAGE_CHARS - 10)}.`
    expect(splitPassages(`${'a'.repeat(200)}. ${second}`)).toEqual([`${'a'.repeat(200)}.`, second])
  })

  it('cuts at sentence ends, so no passage starts mid-sentence', () => {
    for (const passage of splitPassages(paragraph(60))) {
      expect(passage).toMatch(/^Sentence number \d+/)
      expect(passage).toMatch(/words\.$/)
    }
  })

  it('loses no words across the cuts', () => {
    const text = paragraph(60)
    expect(splitPassages(text).join(' ')).toBe(text)
  })

  it('treats a paragraph break as a sentence end even without a full stop', () => {
    expect(splitPassages('A heading\n\nThe body follows.')).toEqual(['A heading The body follows.'])
    const long = `${'x'.repeat(FIRST_PASSAGE_CHARS - 10)}\n\n${'y'.repeat(20)}`
    expect(splitPassages(long)).toEqual(['x'.repeat(FIRST_PASSAGE_CHARS - 10), 'y'.repeat(20)])
  })

  it('cuts a sentence longer than the ceiling at a clause, then at a space', () => {
    const clause = 'a clause of some words'
    const clauses = Array.from({ length: 30 }, () => clause).join(', ')
    const passages = splitPassages(`${clauses}.`)
    expect(passages.length).toBeGreaterThan(1)
    for (const passage of passages) {
      expect(passage.length).toBeLessThanOrEqual(PASSAGE_CHARS)
      expect(passage).not.toMatch(/^,|\s,/)
    }
    expect(passages.join(' ')).toBe(`${clauses}.`)

    const words = Array.from({ length: 200 }, () => 'word').join(' ')
    const wordPassages = splitPassages(words)
    expect(wordPassages.length).toBeGreaterThan(1)
    expect(wordPassages.join(' ')).toBe(words)
  })

  it('hard-cuts a single run with no space in it rather than passing the ceiling', () => {
    const run = 'z'.repeat(PASSAGE_CHARS * 2 + 5)
    const passages = splitPassages(run)
    expect(passages.join('').replaceAll(' ', '')).toBe(run)
    for (const passage of passages) expect(passage.length).toBeLessThanOrEqual(PASSAGE_CHARS)
  })
})
