import { describe, expect, it } from 'vitest'
import { parseLibraryDescription, parseLibraryItem, parseLibraryListing } from './library'

/**
 * The library contract. What is pinned: an item with nothing written about
 * it yet - empty description, empty subject - is still an item, because
 * that is exactly how a freshly kept file arrives; and the fields that
 * must be there still must be.
 */

const ITEM = {
  id: 'lib_1',
  kind: 'image',
  fileName: 'me.png',
  mimeType: 'image/png',
  byteLength: 3,
  title: 'me.png',
  description: '',
  subject: '',
  tags: [],
  sourceConversationId: null,
  createdAt: 1,
  updatedAt: 1,
  path: 'C:/lib/lib_1.png',
}

describe('parseLibraryItem', () => {
  it('accepts an item nobody has described yet', () => {
    expect(parseLibraryItem(ITEM)).toEqual(ITEM)
  })

  it('refuses a missing title, an unknown kind, and a non-string source', () => {
    expect(parseLibraryItem({ ...ITEM, title: '' })).toBeNull()
    expect(parseLibraryItem({ ...ITEM, kind: 'face' })).toBeNull()
    expect(parseLibraryItem({ ...ITEM, sourceConversationId: 4 })).toBeNull()
  })
})

describe('parseLibraryListing', () => {
  it('reads the items, the subjects, the folder and the size cap', () => {
    const listing = parseLibraryListing({ items: [ITEM], subjects: ['me'], directory: 'C:/lib', maxFileBytes: 10 })
    expect(listing?.items).toHaveLength(1)
    expect(listing?.subjects).toEqual(['me'])
    expect(parseLibraryListing({ items: [ITEM] })).toBeNull()
  })
})

describe('parseLibraryDescription', () => {
  it('reads the proposal and ignores a subject the model was never asked for', () => {
    expect(
      parseLibraryDescription({ description: { title: 'Ridge', description: '', tags: ['hiking'], subject: 'x' } }),
    ).toEqual({ title: 'Ridge', description: '', tags: ['hiking'] })
    expect(parseLibraryDescription({ description: { title: 'Ridge' } })).toBeNull()
  })
})
