import { describe, expect, it } from 'vitest'
import {
  FAMILIES_VIEW,
  SEARCH_VIEW,
  familyView,
  modelView,
  viewKey,
  viewMove,
  viewOf,
} from './views'

/**
 * The library's pages, and the moves between them.
 *
 * The drill-down is directional because nothing else is moving when it
 * plays: the dialog frame stands still, so push and pop are the only way the
 * hierarchy says "deeper" and "back". Search is the deliberate exception -
 * it is a filter laid over whichever page is underneath, lateral to
 * everything.
 */

describe('viewMove', () => {
  it('pushes drilling in and pops coming back, along the hierarchy', () => {
    expect(viewMove(FAMILIES_VIEW, familyView('anthropic'))).toBe('push')
    expect(viewMove(familyView('anthropic'), modelView('anthropic/claude'))).toBe('push')
    expect(viewMove(familyView('anthropic'), FAMILIES_VIEW)).toBe('pop')
    expect(viewMove(modelView('anthropic/claude'), familyView('anthropic'))).toBe('pop')
    // Skipping a level is still coming back up: the detail's back row can
    // land on the landing when the model was reached from search.
    expect(viewMove(modelView('anthropic/claude'), FAMILIES_VIEW)).toBe('pop')
  })

  it('keeps lateral moves siblings: family for family, and anything through search', () => {
    expect(viewMove(familyView('anthropic'), familyView('openai'))).toBe('sibling')
    expect(viewMove(SEARCH_VIEW, familyView('anthropic'))).toBe('sibling')
    expect(viewMove(modelView('anthropic/claude'), SEARCH_VIEW)).toBe('sibling')
    expect(viewMove(familyView('anthropic'), familyView('anthropic'))).toBe('sibling')
  })
})

describe('viewOf', () => {
  it('resolves the page from the three inputs, detail winning over search', () => {
    // Nothing anywhere: the landing.
    expect(viewOf('', null, null)).toEqual(FAMILIES_VIEW)
    // A family chosen: its page.
    expect(viewOf('', null, 'anthropic')).toEqual(familyView('anthropic'))
    // A needle: results, whatever family was chosen.
    expect(viewOf('claude', null, 'anthropic')).toBe(SEARCH_VIEW)
    // An open model wins even over the needle still sitting in the field -
    // it is what the reader is looking at, and its back row returns to the
    // results the needle names.
    expect(viewOf('claude', 'anthropic/claude', 'anthropic')).toEqual(
      modelView('anthropic/claude'),
    )
  })

  it('treats a blank needle as no needle at all', () => {
    expect(viewOf('   ', null, null)).toEqual(FAMILIES_VIEW)
  })
})

describe('viewKey', () => {
  it('keys pages so two pages with different content never share one', () => {
    expect(viewKey(FAMILIES_VIEW)).toBe('families')
    expect(viewKey(SEARCH_VIEW)).toBe('search')
    expect(viewKey(familyView('anthropic'))).toBe('family:anthropic')
    expect(viewKey(modelView('anthropic/claude'))).toBe('model:anthropic/claude')
    expect(viewKey(familyView('openai'))).not.toBe(viewKey(familyView('anthropic')))
  })
})
