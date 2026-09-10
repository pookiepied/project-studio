/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DevicesPane } from './DevicesPane'

/**
 * The desktop process is stood in for as a small fake listener: a switch
 * that can refuse, an address reading, a code, and a device list that the
 * pane's actions edit. The pane is tested for what it shows against each
 * state, which is the whole of its job — the listener itself is tested in
 * Rust.
 */
const desktop = vi.hoisted(() => ({
  address: null as string | null,
  refusal: null as string | null,
  addresses: {
    port: 4747,
    namePort: 4747,
    home: ['192.168.1.47'],
    homeName: 'studio.local',
    away: null as { address: string; name: string | null } | null,
  },
  code: 'ABC234',
  devices: [] as { id: string; name: string; pairedAtMs: number; lastSeenMs: number }[],
  preference: null as boolean | null,
}))

vi.mock('@/platform/remote-access', () => ({
  startRemoteAccess: async () => {
    if (desktop.refusal !== null) throw new Error(desktop.refusal)
    desktop.address = `0.0.0.0:${desktop.addresses.port}`
    return desktop.address
  },
  stopRemoteAccess: async () => {
    desktop.address = null
  },
  readRemoteAccessStatus: async () => desktop.address,
  readRemoteAddresses: async () => (desktop.address === null ? null : desktop.addresses),
  readPairingCode: async () => (desktop.address === null ? null : desktop.code),
  listPairedDevices: async () => desktop.devices,
  renamePairedDevice: async (id: string, name: string) => {
    desktop.devices = desktop.devices.map((device) =>
      device.id === id ? { ...device, name } : device,
    )
  },
  revokePairedDevice: async (id: string) => {
    desktop.devices = desktop.devices.filter((device) => device.id !== id)
  },
  revokeAllPairedDevices: async () => {
    desktop.devices = []
  },
  saveRemoteAccessPreference: async (enabled: boolean) => {
    desktop.preference = enabled
  },
  loadRemoteAccessPreference: async () => desktop.preference === true,
}))

vi.mock('@/lib/clipboard', () => ({ copyText: async () => true }))

function onDesktop() {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
}

beforeEach(() => {
  desktop.address = null
  desktop.refusal = null
  desktop.addresses = {
    port: 4747,
    namePort: 4747,
    home: ['192.168.1.47'],
    homeName: 'studio.local',
    away: null,
  }
  desktop.code = 'ABC234'
  desktop.devices = []
  desktop.preference = null
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

async function turnOn() {
  await screen.findByRole('radio', { name: 'On' })
  await act(async () => {
    fireEvent.click(screen.getByRole('radio', { name: 'On' }))
  })
}

describe('DevicesPane', () => {
  it('in a browser, says where the switch is and offers nothing else', () => {
    render(<DevicesPane />)

    expect(screen.getByText(/done from Studio on the PC/)).not.toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('shows nothing reachable until the switch is on, and none of the sections', async () => {
    onDesktop()
    render(<DevicesPane />)

    expect(await screen.findByText(/Nothing is reachable until this is on/)).not.toBeNull()
    // The firewall sentence is a Windows one and jsdom reports no platform,
    // so it is absent here; the desktop sentence is pinned by the hint
    // above, and the address, code and device sections are not shown.
    expect(screen.queryByText('Pairing code')).toBeNull()
    expect(screen.queryByText('Paired devices')).toBeNull()
  })

  it('turning it on shows the addresses labelled for home and away, the QR code, and the code', async () => {
    onDesktop()
    render(<DevicesPane />)
    await turnOn()

    expect(await screen.findByText('http://studio.local:4747')).not.toBeNull()
    expect(screen.getByText('http://192.168.1.47:4747')).not.toBeNull()
    // The code carries the raw address, not the name, so a phone that
    // cannot resolve `.local` still lands somewhere.
    expect(
      screen.getByRole('img', { name: 'QR code for http://192.168.1.47:4747' }),
    ).not.toBeNull()
    // No Tailscale on this machine: no away group, and one quiet line
    // instead of an advertisement.
    expect(screen.queryByText('Away from home')).toBeNull()
    expect(screen.getByText(/if Tailscale is running here/)).not.toBeNull()
    expect(screen.getByLabelText('Pairing code').textContent).toBe('ABC234')
    // The switch took, so the preference is remembered for the next launch.
    expect(desktop.preference).toBe(true)
  })

  it('prints the name bare when the desktop took port 80 for it', async () => {
    onDesktop()
    desktop.addresses.namePort = 80
    render(<DevicesPane />)
    await turnOn()

    expect(await screen.findByText('http://studio.local')).not.toBeNull()
    // The raw address keeps its port: it is the listener, not the name.
    expect(screen.getByText('http://192.168.1.47:4747')).not.toBeNull()
  })

  it('shows the Tailscale name as the away address when the machine has one', async () => {
    onDesktop()
    desktop.addresses.away = { address: '100.101.102.103', name: 'desk.tail1234.ts.net' }
    render(<DevicesPane />)
    await turnOn()

    expect(await screen.findByText('http://desk.tail1234.ts.net:4747')).not.toBeNull()
    expect(screen.getByText('http://100.101.102.103:4747')).not.toBeNull()
    expect(screen.getByText('Away from home')).not.toBeNull()
  })

  it('a refused start is shown as the desktop wrote it, and the preference stays off', async () => {
    onDesktop()
    desktop.refusal = 'Studio could not open port 4747 for other devices: address in use'
    render(<DevicesPane />)
    await turnOn()

    expect(await screen.findByText(desktop.refusal)).not.toBeNull()
    expect(screen.queryByText('Pairing code')).toBeNull()
    expect(desktop.preference).toBe(false)
  })

  it('lists paired devices, and removing one takes it out of the list', async () => {
    onDesktop()
    const now = Date.now()
    desktop.devices = [
      { id: 'a', name: 'Phone', pairedAtMs: now - 86_400_000 * 3, lastSeenMs: now - 30_000 },
      { id: 'b', name: 'Laptop', pairedAtMs: now - 60_000, lastSeenMs: now - 5 * 60_000 },
    ]
    render(<DevicesPane />)
    await turnOn()

    expect(await screen.findByText('Phone')).not.toBeNull()
    expect(screen.getByText('Laptop')).not.toBeNull()
    expect(screen.getByText(/Last seen just now/)).not.toBeNull()
    expect(screen.getByText(/Last seen 5 minutes ago/)).not.toBeNull()

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    })
    await waitFor(() => expect(screen.queryByText('Phone')).toBeNull())
    expect(screen.getByText('Laptop')).not.toBeNull()
    // One device left, so there is nothing for "Remove all" to add.
    expect(screen.queryByRole('button', { name: 'Remove all' })).toBeNull()
  })

  it('renames a device in place', async () => {
    onDesktop()
    const now = Date.now()
    desktop.devices = [{ id: 'a', name: 'Phone', pairedAtMs: now, lastSeenMs: now }]
    render(<DevicesPane />)
    await turnOn()
    await screen.findByText('Phone')

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const field = screen.getByLabelText('Device name')
    fireEvent.change(field, { target: { value: 'My phone' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(await screen.findByText('My phone')).not.toBeNull()
    expect(desktop.devices[0].name).toBe('My phone')
  })

  it('turning it off hides the address, the code and the devices again', async () => {
    onDesktop()
    render(<DevicesPane />)
    await turnOn()
    await screen.findByText('Pairing code')

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Off' }))
    })

    await waitFor(() => expect(screen.queryByText('Pairing code')).toBeNull())
    expect(desktop.address).toBeNull()
    expect(desktop.preference).toBe(false)
  })
})
