/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS_GROUPS } from '@/features/settings/sections'
import { SettingsNav } from './SettingsNav'

afterEach(cleanup)

const button = (name: string | RegExp) => screen.getByRole('button', { name })

describe('the settings side panel', () => {
  it('lists every group, and the pages of the open one only', () => {
    render(<SettingsNav active="appearance" onSelect={vi.fn()} onBack={vi.fn()} />)

    for (const group of SETTINGS_GROUPS) expect(button(group.name)).toBeTruthy()

    expect(button('Application').getAttribute('aria-expanded')).toBe('true')
    expect(button('Providers').getAttribute('aria-expanded')).toBe('false')
    expect(button('Appearance').getAttribute('aria-current')).toBe('page')
    expect(button('General').getAttribute('aria-current')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Models' })).toBeNull()
  })

  it('opens the group of a page reached from anywhere', () => {
    render(<SettingsNav active="hooks" onSelect={vi.fn()} onBack={vi.fn()} />)

    expect(button('Agent').getAttribute('aria-expanded')).toBe('true')
    expect(button(/^Hooks/).getAttribute('aria-current')).toBe('page')
  })

  it('opens a closed group at its first page with something on it', () => {
    const onSelect = vi.fn()
    render(<SettingsNav active="general" onSelect={onSelect} onBack={vi.fn()} />)

    fireEvent.click(button('Providers'))
    expect(onSelect).toHaveBeenLastCalledWith('models')

    // Git and Worktrees are planned, so Coding opens on Environments.
    fireEvent.click(button('Coding'))
    expect(onSelect).toHaveBeenLastCalledWith('environments')
  })

  it('stays on the page when its own group is clicked', () => {
    const onSelect = vi.fn()
    render(<SettingsNav active="appearance" onSelect={onSelect} onBack={vi.fn()} />)

    fireEvent.click(button('Application'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('treats a group of one as its page', () => {
    const onSelect = vi.fn()
    const { rerender } = render(<SettingsNav active="general" onSelect={onSelect} onBack={vi.fn()} />)

    expect(button('Archived').getAttribute('aria-expanded')).toBeNull()
    fireEvent.click(button('Archived'))
    expect(onSelect).toHaveBeenLastCalledWith('archive')

    rerender(<SettingsNav active="archive" onSelect={onSelect} onBack={vi.fn()} />)
    expect(button('Archived').getAttribute('aria-current')).toBe('page')
  })

  it('names the unbuilt pages as planned', () => {
    render(<SettingsNav active="environments" onSelect={vi.fn()} onBack={vi.fn()} />)

    expect(button(/^Git/).textContent).toContain('planned')
    expect(button('Environments').textContent).not.toContain('planned')
  })

  it('leaves Settings', () => {
    const onBack = vi.fn()
    render(<SettingsNav active="general" onSelect={vi.fn()} onBack={onBack} />)

    fireEvent.click(button('Back'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
