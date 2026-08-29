import { describe, expect, it } from 'vitest'

import { moveBetween } from './NavigationProvider'

/**
 * How the surface transition is aimed.
 *
 * The routes are a hierarchy -- home under nothing, a project under home, a
 * conversation under its project, Settings deepest -- and `moveBetween` is the
 * one place that hierarchy becomes a direction. The page transition reads it
 * (`surfaceTransition`), so a wrong answer here is the whole app sliding the
 * wrong way on every navigation.
 */
describe('moveBetween', () => {
  it('drilling in is a push, wherever it starts from', () => {
    expect(moveBetween({ kind: 'home' }, { kind: 'chat', conversationId: 'cnv_1' })).toBe('push')
    expect(moveBetween({ kind: 'home' }, { kind: 'project', projectId: 'prj_1' })).toBe('push')
    expect(moveBetween({ kind: 'project', projectId: 'prj_1' }, { kind: 'chat', conversationId: 'cnv_1' })).toBe(
      'push',
    )
    expect(moveBetween({ kind: 'chat', conversationId: 'cnv_1' }, { kind: 'settings', sectionId: 'general' })).toBe(
      'push',
    )
    expect(moveBetween({ kind: 'home' }, { kind: 'settings', sectionId: 'general' })).toBe('push')
  })

  it('coming back is a pop, the mirror of the way in', () => {
    expect(moveBetween({ kind: 'chat', conversationId: 'cnv_1' }, { kind: 'home' })).toBe('pop')
    expect(moveBetween({ kind: 'project', projectId: 'prj_1' }, { kind: 'home' })).toBe('pop')
    expect(moveBetween({ kind: 'chat', conversationId: 'cnv_1' }, { kind: 'project', projectId: 'prj_1' })).toBe(
      'pop',
    )
    expect(moveBetween({ kind: 'settings', sectionId: 'general' }, { kind: 'chat', conversationId: 'cnv_1' })).toBe(
      'pop',
    )
    expect(moveBetween({ kind: 'settings', sectionId: 'general' }, { kind: 'home' })).toBe('pop')
  })

  it('a lateral step between routes of the same kind is a sibling', () => {
    expect(moveBetween({ kind: 'chat', conversationId: 'cnv_1' }, { kind: 'chat', conversationId: 'cnv_2' })).toBe(
      'sibling',
    )
    expect(moveBetween({ kind: 'settings', sectionId: 'general' }, { kind: 'settings', sectionId: 'appearance' })).toBe(
      'sibling',
    )
    expect(moveBetween({ kind: 'project', projectId: 'prj_1' }, { kind: 'project', projectId: 'prj_2' })).toBe(
      'sibling',
    )
  })
})
