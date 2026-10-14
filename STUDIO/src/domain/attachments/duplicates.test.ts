/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { matchingDocument } from './duplicates'

describe('duplicate document contents', () => {
  it('recognizes the same bytes even under a different name', async () => {
    const original = new File(['report'], 'first.txt')
    expect(await matchingDocument(new File(['report'], 'renamed.txt'), [original])).toBe(original)
  })

  it('keeps different contents with the same name and size', async () => {
    expect(await matchingDocument(new File(['abc'], 'same.txt'), [new File(['xyz'], 'same.txt')])).toBeNull()
  })

  it('checks only files held by this draft', async () => {
    const original = new File(['report'], 'report.txt')
    expect(await matchingDocument(original, [original])).toBe(original)
    expect(await matchingDocument(original, [])).toBeNull()
  })
})
