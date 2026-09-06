import { describe, expect, it } from 'vitest'

import { diffLines } from './diffLines'
import { anchorToRegion, parseFileToolOutcome } from './editOutcome'

describe('parsing a file tool outcome', () => {
  it('reads the real shape of an edit answer: sentence, then the numbered echo', () => {
    // Verbatim shape from the harness: the sentence, a blank line, then the
    // changed span of the post-edit file, numbered with a tab.
    const outcome = parseFileToolOutcome(
      'Edited snake/script.js\n' +
        '\n' +
        '   197\tfunction drawFood(now) {\n' +
        '   198\t    const cx = food.x * CELL + CELL / 2;\n' +
        '   199\t    const cy = food.y * CELL + CELL / 2;\n' +
        '   200\t    // clamp to >= 0: foodSpawnAt is taken with performance.now() mid-frame,\n' +
        '   201\t    // which is always slightly after this frame\'s rAF timestamp, so on the\n' +
        '   202\t    // spawn frame (now - foodSpawnAt) is negative and an unclamped radius\n' +
        '   203\t    // would throw IndexSizeError and kill the render loop\n' +
        '   204\t    const grow = easeOut(Math.max(0, Math.min((now - foodSpawnAt) / 250, 1)));\n' +
        '   205\t    const pulse = 1 + Math.sin(now / 260) * 0.08;\n' +
        '   206\t    const r = CELL * 0.32 * grow * pulse;\n' +
        '   207\t',
    )
    expect(outcome?.status).toBe('Edited snake/script.js')
    expect(outcome?.extra).toEqual([])
    expect(outcome?.region).toHaveLength(11)
    expect(outcome?.region[0]).toEqual({ line: 197, text: 'function drawFood(now) {' })
    expect(outcome?.region[10]).toEqual({ line: 207, text: '' })
  })

  it('reads a write answer as sentences with no echo', () => {
    const outcome = parseFileToolOutcome(
      'Created snake/index.html\nCreated directory snake, which did not exist.',
    )
    expect(outcome?.status).toBe('Created snake/index.html')
    expect(outcome?.extra).toEqual(['Created directory snake, which did not exist.'])
    expect(outcome?.region).toEqual([])
  })

  it('refuses an answer that is only whitespace', () => {
    expect(parseFileToolOutcome('\n  \n')).toBeNull()
  })
})

describe('anchoring an edit to the echo', () => {
  // The real snake edit: one line replaced by a comment block and the clamped
  // line, echoed by the harness at lines 197-207.
  const OLD_TEXT = '    const grow = easeOut(Math.min((now - foodSpawnAt) / 250, 1));'
  const NEW_TEXT = [
    '    // clamp to >= 0: foodSpawnAt is taken with performance.now() mid-frame,',
    "    // which is always slightly after this frame's rAF timestamp, so on the",
    '    // spawn frame (now - foodSpawnAt) is negative and an unclamped radius',
    '    // would throw IndexSizeError and kill the render loop',
    '    const grow = easeOut(Math.max(0, Math.min((now - foodSpawnAt) / 250, 1)));',
  ].join('\n')

  it('numbers the rows from the echo: the removed line and the five additions', () => {
    const diff = diffLines(OLD_TEXT, NEW_TEXT)
    const outcome = parseFileToolOutcome(
      'Edited snake/script.js\n\n' +
        '   197\tfunction drawFood(now) {\n' +
        '   198\t    const cx = food.x * CELL + CELL / 2;\n' +
        '   199\t    const cy = food.y * CELL + CELL / 2;\n' +
        '   200\t    // clamp to >= 0: foodSpawnAt is taken with performance.now() mid-frame,\n' +
        '   201\t    // which is always slightly after this frame\'s rAF timestamp, so on the\n' +
        '   202\t    // spawn frame (now - foodSpawnAt) is negative and an unclamped radius\n' +
        '   203\t    // would throw IndexSizeError and kill the render loop\n' +
        '   204\t    const grow = easeOut(Math.max(0, Math.min((now - foodSpawnAt) / 250, 1)));\n' +
        '   205\t    const pulse = 1 + Math.sin(now / 260) * 0.08;\n' +
        '   206\t    const r = CELL * 0.32 * grow * pulse;\n' +
        '   207\t',
    )
    const anchored = anchorToRegion(diff, outcome?.region ?? [])
    expect(anchored.rows[0]).toMatchObject({ type: 'del', oldLine: 200, newLine: null })
    expect(anchored.rows.slice(1).map((row) => row.newLine)).toEqual([200, 201, 202, 203, 204])
    expect(anchored.added).toBe(5)
    expect(anchored.removed).toBe(1)
  })

  it('numbers context rows on both sides of the change', () => {
    const diff = diffLines('A\nB\nC', 'A\nX\nC')
    const region = [
      { line: 9, text: 'top' },
      { line: 10, text: 'A' },
      { line: 11, text: 'X' },
      { line: 12, text: 'C' },
      { line: 13, text: 'end' },
    ]
    const anchored = anchorToRegion(diff, region)
    expect(anchored.rows[0]).toMatchObject({ type: 'ctx', oldLine: 10, newLine: 10 })
    expect(anchored.rows[1]).toMatchObject({ type: 'del', oldLine: 11 })
    expect(anchored.rows[2]).toMatchObject({ type: 'add', newLine: 11 })
    expect(anchored.rows[3]).toMatchObject({ type: 'ctx', oldLine: 12, newLine: 12 })
  })

  it('tries each candidate anchor until one corroborates the whole walk', () => {
    // 'same' stands twice in the echo; only the second placement lets the
    // added line corroborate, so the first must be tried and refused.
    const diff = diffLines('same', 'same\nonly')
    const region = [
      { line: 1, text: 'x' },
      { line: 2, text: 'y' },
      { line: 3, text: 'same' },
      { line: 4, text: 'same' },
      { line: 5, text: 'only' },
    ]
    const anchored = anchorToRegion(diff, region)
    expect(anchored.rows[0]).toMatchObject({ type: 'ctx', oldLine: 4, newLine: 4 })
    expect(anchored.rows[1]).toMatchObject({ type: 'add', newLine: 5 })
  })

  it('numbers nothing when the echo does not corroborate the rows', () => {
    const diff = diffLines(OLD_TEXT, NEW_TEXT)
    const anchored = anchorToRegion(diff, [{ line: 3, text: 'unrelated line' }])
    expect(anchored).toBe(diff)
  })

  it('numbers nothing when the echo covers only part of the strings', () => {
    const diff = diffLines('A\nB\nC', 'A\nX\nC')
    const region = [
      { line: 7, text: 'X' },
      { line: 8, text: 'C' },
    ]
    const anchored = anchorToRegion(diff, region)
    expect(anchored).toBe(diff)
  })
})
