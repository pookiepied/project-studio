/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { NavigationProvider, useNavigation } from './NavigationProvider'

/**
 * The Settings visit: what entering and leaving does to the route and to the
 * sidebar column.
 *
 * While Settings is the route the sidebar column holds the settings tree, so
 * the column is the only settings navigation there is and the store has to own
 * its behaviour around the visit: entering opens a closed column, leaving puts
 * it back the way the user had it, and moving it deliberately during the visit
 * outranks the restoration. Every way in and out -- Ctrl , the palette, the
 * footer, the back control -- funnels through the three functions below, so
 * holding the contract here holds it everywhere.
 */

function Probe() {
  const { route, sidebarOpen, openChat, openSettings, leaveSettings, toggleSidebar } =
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

function routeLabel(): string {
  const node = screen.getByText(/^route:/)
  return node.textContent ?? ''
}

function sidebarOpen(): boolean {
  const node = screen.getByText(/^sidebar:/)
  return (node.textContent ?? '').endsWith('true')
}

function click(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('entering Settings', () => {
  it('opens the closed column, because the tree inside it is the only navigation there is', () => {
    mount()
    click('open chat')
    expect(routeLabel()).toBe('route:chat')
    expect(sidebarOpen()).toBe(false)

    click('open settings')
    expect(routeLabel()).toBe('route:settings:general')
    expect(sidebarOpen()).toBe(true)
  })

  it('leaves a column the user had open exactly alone', () => {
    mount()
    click('toggle sidebar')
    click('open settings')
    expect(sidebarOpen()).toBe(true)
  })
})

describe('inside the visit', () => {
  it('switching sections never moves the return point', () => {
    mount()
    click('open chat')
    click('open settings')

    click('open appearance')
    expect(routeLabel()).toBe('route:settings:appearance')

    click('leave settings')
    expect(routeLabel()).toBe('route:chat')
  })
})

describe('leaving Settings', () => {
  it('back returns to the conversation and puts the closed column away again', () => {
    mount()
    click('open chat')
    click('open settings')
    expect(sidebarOpen()).toBe(true)

    click('leave settings')
    expect(routeLabel()).toBe('route:chat')
    expect(sidebarOpen()).toBe(false)
  })

  it('back from a visit entered at home lands on home, every time', () => {
    mount()
    click('open settings')
    click('leave settings')
    expect(routeLabel()).toBe('route:home')
    expect(sidebarOpen()).toBe(false)
  })

  it('restores the column on any way out, including opening a conversation from the palette', () => {
    mount()
    click('open settings')
    expect(sidebarOpen()).toBe(true)

    click('open chat')
    expect(routeLabel()).toBe('route:chat')
    expect(sidebarOpen()).toBe(false)
  })

  it('keeps the column as the user left it when they moved it during the visit', () => {
    mount()
    click('open chat')
    click('open settings')
    expect(sidebarOpen()).toBe(true)

    // Deliberately closed while in Settings: leaving must not force it open
    // again -- the last deliberate act wins over the stored entry state.
    click('toggle sidebar')
    click('leave settings')
    expect(routeLabel()).toBe('route:chat')
    expect(sidebarOpen()).toBe(false)
  })

  it('keeps a column open that the user reopened during the visit', () => {
    mount()
    click('open chat')
    click('open settings')
    click('toggle sidebar')
    click('toggle sidebar')
    expect(sidebarOpen()).toBe(true)

    click('leave settings')
    expect(sidebarOpen()).toBe(true)
  })

  it('forgets the visit once it is over, so the next entry starts fresh', () => {
    mount()
    click('open settings')
    click('leave settings')
    expect(sidebarOpen()).toBe(false)

    // The column was restored to closed; a second visit must capture that
    // state again rather than inherit anything from the first one.
    click('toggle sidebar')
    click('open settings')
    expect(sidebarOpen()).toBe(true)
    click('leave settings')
    expect(sidebarOpen()).toBe(true)
  })
})
