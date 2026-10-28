import { describe, expect, it } from 'vitest'
import { markCommandOf } from './marks'

const set = { id: 'm1', display: { index: 1, x: 1920, y: 0, width: 2560, height: 1440 }, expiresAt: 5000, marks: [{ kind: 'ring', x: 10, y: 20, width: 30, height: 40, label: 'Save' }] }

describe('reading a mark answer', () => {
  it('finds the marks in the raw answer or wrapped by persistence', () => {
    expect(markCommandOf({ structuredContent: { marks: set } })).toEqual({ kind: 'show', set })
    expect(markCommandOf({ value: { structuredContent: { marks: set } } })).toEqual({ kind: 'show', set })
    expect(markCommandOf({ result: { structuredContent: { marks: { clear: true } } } })).toEqual({ kind: 'clear' })
  })

  it('answers nothing for a shape it does not know rather than throwing', () => {
    expect(markCommandOf(null)).toBeNull()
    expect(markCommandOf({ structuredContent: { marks: { ...set, display: null } } })).toBeNull()
    expect(markCommandOf({ structuredContent: { marks: { ...set, marks: [{ kind: 'star', x: 1, y: 1 }] } } })).toBeNull()
  })
})
