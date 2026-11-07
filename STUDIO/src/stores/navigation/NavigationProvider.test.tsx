/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { NavigationProvider, useNavigation } from './NavigationProvider'

/**
 * The Settings visit. Settings carries its own section list, so the visit owns
 * one fact: where Back returns to. The sidebar stays as the user left it, except
 * that a drawer does not stay open over the page it just opened. Every way in
 * and out funnels through the functions below, so holding the contract here
 * holds it everywhere.
 */

function Probe() {
  const { route, sidebarOpen, openChat, openSettings, leaveSettings, toggleSidebar, setCompactLayout } =
    useNavigation()

  return (
    <div>
      <p>
        route:{route.kind}
        {route.kind === 'settings' ? `:${route.sectionId}` : ''}
      </p>
      <p>sidebar:{String(sidebarOpen)}</p>
      <button type="button" onClick={() => openChat('cnv_1')}>
        open chat
      </button>
      <button type="button" onClick={() => openSettings()}>
        open settings
      </button>
      <button type="button" onClick={() => openSettings('appearance')}>
        open appearance
      </button>
      <button type="button" onClick={leaveSettings}>
        leave settings
      </button>
      <button type="button" onClick={toggleSidebar}>
        toggle sidebar
      </button>
      <button type="button" onClick={() => setCompactLayout(true)}>
        go compact
      </button>
    </div>
  )
}

function mount() {
  return render(
    <NavigationProvider>
      <Probe />
    </NavigationProvider>,
  )
}

afterEach(cleanup)

function click(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('entering Settings', () => {
  it('leaves a closed column closed and an open column open', () => {
    mount()
    click('open settings')
    expect(screen.getByText('sidebar:false')).toBeTruthy()

    click('leave settings')
    click('toggle sidebar')
    click('open settings')
    expect(screen.getByText('sidebar:true')).toBeTruthy()
  })

  it('dismisses the drawer on a narrow window', () => {
    mount()
    click('go compact')
    click('toggle sidebar')
    expect(screen.getByText('sidebar:true')).toBeTruthy()

    click('open settings')
    expect(screen.getByText('route:settings:general')).toBeTruthy()
    expect(screen.getByText('sidebar:false')).toBeTruthy()
  })
})

describe('inside the visit', () => {
  it('switching sections never moves the return point', () => {
    mount()
    click('open chat')
    click('open settings')
    click('open appearance')
    expect(screen.getByText('route:settings:appearance')).toBeTruthy()

    click('leave settings')
    expect(screen.getByText('route:chat')).toBeTruthy()
  })
})

describe('leaving Settings', () => {
  it('back from a visit entered at home lands on home', () => {
    mount()
    click('open settings')
    click('leave settings')
    expect(screen.getByText('route:home')).toBeTruthy()
  })

  it('leaves the column as the user set it during the visit', () => {
    mount()
    click('open settings')
    click('toggle sidebar')
    click('leave settings')
    expect(screen.getByText('sidebar:true')).toBeTruthy()
  })
})
