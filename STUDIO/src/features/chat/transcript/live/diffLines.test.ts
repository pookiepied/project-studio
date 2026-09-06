import { describe, expect, it } from 'vitest'

import { diffLines, wholeFileDiff } from './diffLines'

/**
 * The line diff the tool chips expand, at the level the display depends on:
 * rows are facts about the two strings and nothing else, the trailing
 * newline closes rather than opens, and the line numbers a whole-file write
 * may claim are the only ones anything may claim.
 */
describe('diffLines', () => {
  it('pairs equal lines and marks the rest', () => {
    const { rows, added, removed } = diffLines('a\nb\nc', 'a\nx\nc')
    expect(rows).toEqual([
      { type: 'ctx', oldLine: null, newLine: null, text: 'a' },
      { type: 'del', oldLine: null, newLine: null, text: 'b' },
      { type: 'add', oldLine: null, newLine: null, text: 'x' },
      { type: 'ctx', oldLine: null, newLine: null, text: 'c' },
    ])
    expect(added).toBe(1)
    expect(removed).toBe(1)
  })

  it('inserts without rewriting the neighbourhood', () => {
    const { rows, added, removed } = diffLines('a\nc', 'a\nb\nc')
    expect(rows.map((row) => row.type)).toEqual(['ctx', 'add', 'ctx'])
    expect(added).toBe(1)
    expect(removed).toBe(0)
  })

  it('counts a pure deletion', () => {
    const { rows, added, removed } = diffLines('a\nb\nc', 'c')
    expect(rows.map((row) => `${row.type}:${row.text}`)).toEqual(['del:a', 'del:b', 'ctx:c'])
    expect(added).toBe(0)
    expect(removed).toBe(2)
  })

  it('reads a trailing newline as closing a line, not opening one', () => {
    const { rows, added } = diffLines('a\n', 'a\nb\n')
    expect(rows.map((row) => row.text)).toEqual(['a', 'b'])
    expect(rows.some((row) => row.text === '')).toBe(false)
    expect(added).toBe(1)
  })

  it('reads an empty old side as all additions', () => {
    const { rows, added, removed } = diffLines('', 'a\nb')
    expect(rows.map((row) => row.type)).toEqual(['add', 'add'])
    expect(added).toBe(2)
    expect(removed).toBe(0)
  })

  it('reads identical texts as all context', () => {
    const { rows, added, removed } = diffLines('a\nb', 'a\nb')
    expect(rows.every((row) => row.type === 'ctx')).toBe(true)
    expect(added).toBe(0)
    expect(removed).toBe(0)
  })

  it('never carries line numbers it was not given', () => {
    const { rows } = diffLines('a\nb', 'a\nc')
    expect(rows.every((row) => row.oldLine === null && row.newLine === null)).toBe(true)
  })

  it('states both sides unpaired past the cell budget, still exactly as sent', () => {
    const oldText = Array.from({ length: 800 }, (_, i) => `old ${i}`).join('\n')
    const newText = Array.from({ length: 800 }, (_, i) => `new ${i}`).join('\n')
    const { rows, added, removed } = diffLines(oldText, newText)
    expect(rows).toHaveLength(1600)
    expect(rows.slice(0, 800).every((row) => row.type === 'del')).toBe(true)
    expect(rows.slice(800).every((row) => row.type === 'add')).toBe(true)
    expect(added).toBe(800)
    expect(removed).toBe(800)
  })
})

describe('wholeFileDiff', () => {
  it('numbers the lines of the file the call sent, and only those', () => {
    const { rows, added, removed } = wholeFileDiff('one\ntwo\n')
    expect(rows).toEqual([
      { type: 'add', oldLine: null, newLine: 1, text: 'one' },
      { type: 'add', oldLine: null, newLine: 2, text: 'two' },
    ])
    expect(added).toBe(2)
    expect(removed).toBe(0)
  })

  it('reads an empty write as a diff with no rows', () => {
    const { rows, added, removed } = wholeFileDiff('')
    expect(rows).toEqual([])
    expect(added).toBe(0)
    expect(removed).toBe(0)
  })
})
