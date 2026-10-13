import { describe, expect, it } from 'vitest'

import { highlightSpans, parseSearchOutcome, parseSearchQuery } from './searchOutcome'

/**
 * The search answer, parsed. Each assertion pins one clause of the harness's
 * small formats: the numbered rows of a content search and their `:`/`-`
 * marks, the bare paths of a file list, the `path: count` rows of a count,
 * the whole-sentence match of an empty search, the trailing note with its
 * brackets off -- and the refusal to read anything else, which is what keeps
 * a misparse from ever reaching the card.
 */
describe('the query', () => {
  it('names the pattern, the scope, and the filters', () => {
    expect(
      parseSearchQuery('grep', {
        pattern: 'foodSpawnAt',
        path: 'src',
        outputMode: 'content',
        glob: '*.ts',
        type: 'ts',
        caseInsensitive: true,
      }),
    ).toMatchObject({
      toolName: 'grep',
      pattern: 'foodSpawnAt',
      scope: 'src',
      filters: ['*.ts', 'type: ts', 'case-insensitive'],
      mode: 'content',
      caseInsensitive: true,
    })
  })

  it('reads the whole project as no scope', () => {
    expect(parseSearchQuery('grep', { pattern: 'x', path: '.' })?.scope).toBeNull()
    expect(parseSearchQuery('glob', { pattern: '*.ts' })?.scope).toBeNull()
  })

  it('reads a glob as a file listing', () => {
    expect(parseSearchQuery('glob', { pattern: '*.ts' })).toMatchObject({
      toolName: 'glob',
      mode: 'files',
    })
  })

  it('defaults an omitted grep mode to files, as the harness does', () => {
    expect(parseSearchQuery('grep', { pattern: 'x' })?.mode).toBe('files')
  })

  it('declines a patternless input, an unknown mode, and another tool', () => {
    expect(parseSearchQuery('grep', { path: 'src' })).toBeNull()
    expect(parseSearchQuery('grep', { pattern: 'x', outputMode: 'lines' })).toBeNull()
    expect(parseSearchQuery('shell', { pattern: 'x' })).toBeNull()
    expect(parseSearchQuery('grep', null)).toBeNull()
  })
})

describe('a content answer', () => {
  const INPUT = { pattern: 'foodSpawnAt', path: 'src', outputMode: 'content' }
  const OUTPUT =
    'snake/script.js\n' +
    '   197: const grow = easeOut(foodSpawnAt);\n' +
    '   198- // the spawn timestamp\n' +
    '   199: foodSpawnAt = now;\n' +
    '\n' +
    'snake/food.js\n' +
    '     3: import { foodSpawnAt } from "./script.js";\n' +
    '\n' +
    '[showing 4 of 9 lines; raise limit or use offset for more]'

  it('groups the hits by file, on their line numbers', () => {
    const outcome = parseSearchOutcome('grep', INPUT, OUTPUT)
    expect(outcome?.body).toEqual({
      kind: 'content',
      files: [
        {
          path: 'snake/script.js',
          lines: [
            { line: 197, text: 'const grow = easeOut(foodSpawnAt);', hit: true },
            { line: 198, text: '// the spawn timestamp', hit: false },
            { line: 199, text: 'foodSpawnAt = now;', hit: true },
          ],
          matches: 2,
        },
        {
          path: 'snake/food.js',
          lines: [{ line: 3, text: 'import { foodSpawnAt } from "./script.js";', hit: true }],
          matches: 1,
        },
      ],
      matches: 3,
    })
    expect(outcome?.note).toBe('showing 4 of 9 lines; raise limit or use offset for more')
  })

  it('refuses a block whose rows are not numbered lines', () => {
    // A multiline match carries its text across lines, so the continuation
    // stands without a number -- the one shape that breaks the grammar, and
    // the reason the rule fails shut instead of guessing.
    expect(
      parseSearchOutcome(
        'grep',
        { ...INPUT, multiline: true },
        'snake/script.js\n   197: first half\nsecond half\n',
      ),
    ).toBeNull()
    expect(parseSearchOutcome('grep', INPUT, 'snake/script.js\n')).toBeNull()
    expect(parseSearchOutcome('grep', INPUT, '')).toBeNull()
  })
})

describe('a file-list answer', () => {
  it('reads grep files with their note', () => {
    const outcome = parseSearchOutcome(
      'grep',
      { pattern: 'foodSpawnAt', outputMode: 'files' },
      'snake/script.js\nsnake/food.js\n\n[showing 2 of 5 files; raise limit or use offset for more]',
    )
    expect(outcome?.body).toEqual({ kind: 'files', paths: ['snake/script.js', 'snake/food.js'] })
    expect(outcome?.note).toBe('showing 2 of 5 files; raise limit or use offset for more')
  })

  it('reads a glob with its sort note', () => {
    const outcome = parseSearchOutcome(
      'glob',
      { pattern: '*.ts' },
      'src/z.ts\nsrc/a.ts\n\n[sorted by name, not by modified time: 1200 matches is above the 500 limit]',
    )
    expect(outcome?.body).toEqual({ kind: 'files', paths: ['src/z.ts', 'src/a.ts'] })
    expect(outcome?.note).toBe(
      'sorted by name, not by modified time: 1200 matches is above the 500 limit',
    )
  })

  it('refuses a list broken by a blank line', () => {
    expect(parseSearchOutcome('glob', { pattern: '*.ts' }, 'src/a.ts\n\nsrc/b.ts\n')).toBeNull()
  })
})

describe('a count answer', () => {
  it('reads the rows and sums the total', () => {
    const outcome = parseSearchOutcome(
      'grep',
      { pattern: 'foodSpawnAt', outputMode: 'count' },
      'snake/script.js: 3\nsnake/food.js: 12\n',
    )
    expect(outcome?.body).toEqual({
      kind: 'count',
      rows: [
        { path: 'snake/script.js', count: 3 },
        { path: 'snake/food.js', count: 12 },
      ],
      total: 15,
    })
    expect(outcome?.note).toBeNull()
  })

  it('refuses a row without a numeric count', () => {
    expect(
      parseSearchOutcome('grep', { pattern: 'x', outputMode: 'count' }, 'snake/script.js: many\n'),
    ).toBeNull()
  })
})

describe('an empty answer', () => {
  it('keeps the harness sentence whole', () => {
    for (const sentence of [
      'No matches.',
      'No matches. Ignored directories such as node_modules were not searched; set includeIgnored to include them.',
      'No files matched.',
      'No files matched. Ignored directories such as node_modules were not searched; set includeIgnored to include them.',
    ]) {
      expect(parseSearchOutcome('grep', { pattern: 'zzz' }, sentence)?.body).toEqual({
        kind: 'none',
        sentence,
      })
    }
  })

  it('does not mistake a path for the sentence', () => {
    // Matched whole, not by prefix: a file wearing the sentence's first
    // words is still a file. A prefix match would have read this as empty.
    expect(parseSearchOutcome('glob', { pattern: '*' }, 'No matches found.txt\n')?.body).toEqual({
      kind: 'files',
      paths: ['No matches found.txt'],
    })
  })
})

/** Where the pattern lands inside one matched line. */
describe('the highlight', () => {
  const query = { pattern: 'foodSpawnAt', caseInsensitive: false, multiline: false }

  it('marks every landing and keeps the rest', () => {
    expect(highlightSpans('eat foodSpawnAt, foodSpawnAt!', query)).toEqual([
      { text: 'eat ', hit: false },
      { text: 'foodSpawnAt', hit: true },
      { text: ', ', hit: false },
      { text: 'foodSpawnAt', hit: true },
      { text: '!', hit: false },
    ])
  })

  it('follows the call case flag', () => {
    expect(highlightSpans('FOODSPAWNAT', query)).toBeNull()
    expect(highlightSpans('FOODSPAWNAT', { ...query, caseInsensitive: true })).toEqual([
      { text: 'FOODSPAWNAT', hit: true },
    ])
  })

  it('renders plain when the expression is not one this engine reads', () => {
    // Valid for ripgrep, nonsense here: no highlight, not a crash.
    expect(highlightSpans('abc', { ...query, pattern: '[[:alpha:]]+' })).toBeNull()
    expect(highlightSpans('abc', { ...query, pattern: '(' })).toBeNull()
  })

  it('renders plain when the expression touches nothing', () => {
    expect(highlightSpans('nothing here', query)).toBeNull()
    expect(highlightSpans('', query)).toBeNull()
  })
})
