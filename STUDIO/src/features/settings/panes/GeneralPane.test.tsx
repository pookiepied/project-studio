/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GeneralPane } from './GeneralPane'

/**
 * The two rows that are about being a desktop app — closing to the tray and
 * launching at startup — do not render in a browser, where neither setting
 * means anything (plan step 6). Stated for both surfaces: the desktop answer
 * is pinned by standing in the webview's shoes, the browser answer by their
 * absence.
 */

const workspace = vi.hoisted(() => ({
  settings: { permission: 'manual' },
  setSettings: vi.fn(),
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => workspace,
}))

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

describe('GeneralPane', () => {
  it('offers the tray and startup rows on the desktop', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    render(<GeneralPane />)

    expect(screen.getByText('Keep running when the window closes')).not.toBeNull()
    expect(screen.getByText('Launch at startup')).not.toBeNull()
  })

  it('hides them in a browser, where neither setting means anything', () => {
    render(<GeneralPane />)

    expect(screen.queryByText('Keep running when the window closes')).toBeNull()
    expect(screen.queryByText('Launch at startup')).toBeNull()
    // The rest of the pane is not part of the degradation.
    expect(screen.getByText('Execution mode')).not.toBeNull()
    expect(screen.getByText('Studio version')).not.toBeNull()
  })
})
