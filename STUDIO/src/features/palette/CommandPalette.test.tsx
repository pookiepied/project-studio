/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The palette in ARIA's words: a combobox over a listbox.
 *
 * Focus stays in the field while the arrows move a highlight, so a screen
 * reader has to be told which row is current some other way - that is
 * `aria-activedescendant`, and it has to name a real `option` in the list.
 */

vi.mock('@/stores/navigation', () => ({
  useNavigation: () => ({
    paletteOpen: true,
    setPaletteOpen: vi.fn(),
    openChat: vi.fn(),
    openProject: vi.fn(),
    openSettings: vi.fn(),
    goHome: vi.fn(),
    toggleSidebar: vi.fn(),
  }),
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({ conversations: [], projects: [] }),
}))

const { CommandPalette } = await import('./CommandPalette')

afterEach(cleanup)

describe('CommandPalette', () => {
  it('is a combobox whose active descendant is an option in its listbox', () => {
    render(<CommandPalette onNewProject={() => {}} />)
    const field = screen.getByRole('combobox')
    const list = screen.getByRole('listbox')
    const options = screen.getAllByRole('option')

    expect(field.getAttribute('aria-controls')).toBe(list.id)
    expect(options.length).toBeGreaterThan(1)
    expect(field.getAttribute('aria-activedescendant')).toBe(options[0]?.id)
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(field.getAttribute('aria-activedescendant')).toBe(options[1]?.id)
    expect(options[0]?.getAttribute('aria-selected')).toBe('false')
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')
  })
})
