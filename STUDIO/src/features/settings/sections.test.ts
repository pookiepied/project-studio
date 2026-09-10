import { describe, expect, it } from 'vitest'

import { ALL_SECTIONS, SETTINGS_GROUPS, findSection } from './sections'

/**
 * The taxonomy is an argument rendered as data, so the argument is tested as
 * data: every section sits under the group that answers what it *is*, no id
 * repeats, and the ids other surfaces address by name still resolve. A
 * regrouping that only moved rows would fail the first assertion; a section
 * added to two groups at once would fail the second; a renamed section would
 * fail the deep links the footer and the palette hold.
 */
describe('the settings taxonomy', () => {
  it('files every section under the group that answers what it is', () => {
    const members = new Map(
      SETTINGS_GROUPS.map((group) => [group.id, group.sections.map((section) => section.id)]),
    )

    expect(members.get('application')).toEqual(['general', 'appearance', 'devices', 'shortcuts'])
    expect(members.get('account')).toEqual(['account', 'personalization'])
    expect(members.get('models')).toEqual(['providers'])
    expect(members.get('extensions')).toEqual(['mcp', 'connectors', 'browser-use'])
    expect(members.get('agent')).toEqual(['skills', 'hooks'])
    expect(members.get('coding')).toEqual(['git', 'worktrees', 'environments'])
    expect(members.get('archived')).toEqual(['archive'])
  })

  it('has no voice section, and no id appears twice', () => {
    // Voice was removed outright: dictation and spoken replies stay features
    // of the composer and the transcript, but there is no Voice page to
    // configure and no section that pretends there is.
    expect(findSection('voice')).toBeUndefined()

    const ids = ALL_SECTIONS.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the ids other surfaces address by name', () => {
    // The sidebar footer opens Account by id, the palette lists every section
    // by id, and the navigation default lands on General.
    expect(findSection('account')?.name).toBe('Account')
    expect(findSection('general')?.name).toBe('General')
    expect(findSection('providers')?.name).toBe('Providers')
  })
})
