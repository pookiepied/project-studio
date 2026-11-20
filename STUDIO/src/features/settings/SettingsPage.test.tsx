/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsPage } from './SettingsPage'

vi.mock('@/features/settings/panes/registry', () => ({ paneFor: (id: string) => <p>Pane {id}</p> }))

afterEach(cleanup)

describe('Settings', () => {
  it('shows the selected pane without a second navigation column', () => {
    render(<SettingsPage sectionId="models" />)

    expect(screen.getByText('Pane models')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull()
  })

  it('treats an unknown id as General, not a crash', () => {
    render(<SettingsPage sectionId="gone" />)
    expect(screen.getByText('Pane general')).toBeTruthy()
  })
})
