import { describe, expect, it } from 'vitest'
import { captionTokens } from './captions'

describe('captionTokens', () => {
  it('keeps the gaps between words and punctuation on its word', () => {
    expect(captionTokens('Hello, world. Ready?')).toEqual(['Hello,', ' ', 'world.', ' ', 'Ready?'])
  })

  it('collapses line breaks and runs of spaces into one gap', () => {
    expect(captionTokens('One.\n\nTwo   three')).toEqual(['One.', ' ', 'Two', ' ', 'three'])
  })

  it('drops Markdown marks the voice never says', () => {
    expect(captionTokens('## Done\n- **Saved** the `file`, see [notes](https://x.test).').join(''))
      .toBe('Done Saved the file, see notes.')
    expect(captionTokens('It is *really* done_ok').join('')).toBe('It is really done_ok')
  })
})
