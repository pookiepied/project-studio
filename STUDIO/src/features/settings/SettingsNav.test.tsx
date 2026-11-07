/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS_GROUPS } from '@/features/settings/sections'
import { SettingsNav } from './SettingsNav'

afterEach(cleanup)

describe('the settings section list', () => {
  it('lists every group and marks the open section', () => {
    render(<SettingsNav active="appearance" onSelect={vi.fn()} onBack={vi.fn()} />)

    for (const group of SETTINGS_GROUPS) {
      expect(screen.getByText((content, element) => element?.tagName === 'P' && content === group.name)).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: 'Appearance' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBeNull()
  })

  it('opens a section and leaves Settings', () => {
    const onSelect = vi.fn()
    const onBack = vi.fn()
    render(<SettingsNav active="general" onSelect={onSelect} onBack={onBack} />)

    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    expect(onSelect).toHaveBeenCalledWith('models')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
