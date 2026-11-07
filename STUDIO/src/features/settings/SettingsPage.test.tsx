/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsPage } from './SettingsPage'

const openSettings = vi.fn()
const leaveSettings = vi.fn()

vi.mock('@/stores/navigation', () => ({ useNavigation: () => ({ openSettings, leaveSettings }) }))
vi.mock('@/features/settings/panes/registry', () => ({ paneFor: (id: string) => <p>Pane {id}</p> }))

beforeEach(() => {
  openSettings.mockClear()
  leaveSettings.mockClear()
})

afterEach(cleanup)

describe('Settings', () => {
  it('shows the side panel beside the page', () => {
    render(<SettingsPage sectionId="models" />)

    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeTruthy()
    expect(screen.getByText('Pane models')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Media' }))
    expect(openSettings).toHaveBeenLastCalledWith('media')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(leaveSettings).toHaveBeenCalledTimes(1)
  })

  it('treats an unknown id as General, not a crash', () => {
    render(<SettingsPage sectionId="gone" />)
    expect(screen.getByText('Pane general')).toBeTruthy()
  })
})
