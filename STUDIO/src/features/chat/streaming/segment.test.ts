import { describe, expect, it } from 'vitest'

import { segment } from '@/features/chat/streaming/segment'

/** The block being written, which is the only one this file is about. */
function tailOf(text: string): string {
  return segment(text, false).tail
}

describe('the finished part and the live part', () => {
  it('keeps a finished paragraph out of the tail, so it is never re-parsed', () => {
    const { stable, tail } = segment('Done.\n\nStill going', false)

    expect(stable).toEqual(['Done.'])
    expect(tail).toBe('Still going')
  })

  it('has no tail once the message has settled', () => {
    // A settled message re-renders one final time if the last block moves from
    // tail to stable, so it is stable from the start instead.
    expect(segment('All of it.', true)).toEqual({ stable: ['All of it.'], tail: '' })
  })
})

describe('inline markup, closed while it is still being written', () => {
  it('keeps indented code memoizable without mistaking it for list continuation', () => {
    const { stable } = segment('Intro.\n\n```python\nif ready:\n    print("done")\n```\n\nNext paragraph.', false)
    expect(stable).toEqual(['Intro.', '```python\nif ready:\n    print("done")\n```'])
  })

  // The reason this exists: the tail is parsed on every frame, so a half-typed
  // delimiter renders as literal punctuation and then rewrites itself when the
  // closer lands. Emphasis is wider than plain text, so the line re-wraps and
  // everything after it moves.

  it('closes emphasis so the words are bold before the closer arrives', () => {
    expect(tailOf('This is **import')).toBe('This is **import**')
  })

  it('closes a single-character emphasis run', () => {
    expect(tailOf('An *aside')).toBe('An *aside*')
  })

  it('closes the whole run, so triple stays triple', () => {
    expect(tailOf('Very ***loud')).toBe('Very ***loud***')
  })

  it('closes strikethrough only as a pair', () => {
    expect(tailOf('Was ~~wrong')).toBe('Was ~~wrong~~')
    // A lone tilde is a tilde. Closing it would invent markup.
    expect(tailOf('Roughly ~5 mi')).toBe('Roughly ~5 mi')
  })

  it('closes a code span, and treats what follows as code rather than markup', () => {
    // The `*` is inside the span, so it is a literal asterisk and must not be
    // mistaken for emphasis that needs closing too.
    expect(tailOf('Call `run(*a')).toBe('Call `run(*a`')
  })

  it('leaves a balanced code span alone', () => {
    expect(tailOf('Call `run()` next')).toBe('Call `run()` next')
  })

  it('closes a link destination, so the raw URL is never on screen', () => {
    // This is the most violent case without the fix: the whole URL sits in the
    // paragraph at full width, then collapses to the link text when `)` lands.
    expect(tailOf('See [the docs](https://example.com/a/long/path')).toBe(
      'See [the docs](https://example.com/a/long/path)',
    )
  })

  it('leaves an unfinished link text alone, because closing it shows a bracket', () => {
    // `[the docs` and `[the docs]` both render as literal text, so adding the
    // bracket buys nothing and puts a character on screen nobody typed.
    expect(tailOf('See [the docs')).toBe('See [the docs')
  })

  it('nests, closing the inner delimiter first', () => {
    expect(tailOf('A **bold *and')).toBe('A **bold *and***')
  })
})

describe('what must never be closed', () => {
  // The failure this guards against is worse than the problem it fixes: text
  // that goes italic halfway through an expression is a bug the reader cannot
  // explain, where a late-arriving bold is merely ugly.

  it('leaves arithmetic upright', () => {
    // A run followed by a space cannot open emphasis, which is what saves this.
    expect(tailOf('Roughly 2 * 3 * 4 items')).toBe('Roughly 2 * 3 * 4 items')
  })

  it('leaves an identifier alone, because `_` does not open inside a word', () => {
    expect(tailOf('The snake_case_name field')).toBe('The snake_case_name field')
    expect(tailOf('Read snake_case')).toBe('Read snake_case')
  })

  it('does not open on a delimiter that is still the last character typed', () => {
    // Nothing follows it yet, so there is nothing to emphasise. This also
    // means `**bold` never passes through an italic frame on its way in: the
    // run is measured whole, so it is either two characters or it is one.
    expect(tailOf('Ends with *')).toBe('Ends with *')
    expect(tailOf('Ends with **')).toBe('Ends with **')
  })

  it('leaves a list bullet as a bullet', () => {
    expect(tailOf('- one\n- two')).toBe('- one\n- two')
    expect(tailOf('* one\n* two')).toBe('* one\n* two')
  })

  it('respects a backslash escape', () => {
    expect(tailOf('A literal \\*asterisk')).toBe('A literal \\*asterisk')
  })

  it('does not balance the delimiters inside a code block', () => {
    // An open fence is closed by the fence rule; its contents are code, and
    // the asterisks in them are not markup.
    expect(tailOf('```py\nx = a * b\n')).toBe('```py\nx = a * b\n```')
  })
})
