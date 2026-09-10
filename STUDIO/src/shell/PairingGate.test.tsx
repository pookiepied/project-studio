/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PairingGate } from './PairingGate'

/**
 * The gate a browser passes through, and the pairing screen behind it.
 *
 * The load-bearing ones are the two sides of the done-when: an unpaired
 * browser gets the pairing screen and *nothing else*, a paired one gets the
 * studio. Around them, the two ways a page is not served by Studio's listener
 * at all — Tauri, and a host that never answers the state route — must render
 * exactly as they always did, because `vite dev` and the desktop are not
 * devices and must not spend a round trip learning it.
 */

const isTauri = vi.fn<() => boolean>()
const readPairingState = vi.fn<() => Promise<boolean | null>>()

vi.mock('@/platform/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/tauri')>()
  return { ...actual, isTauri: () => isTauri() }
})

vi.mock('@/platform/harness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/harness')>()
  return { ...actual, readPairingState: () => readPairingState() }
})

const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>()

function aResponse(body: { ok: boolean; status: number; json: unknown }): Response {
  return {
    ok: body.ok,
    status: body.status,
    json: () => Promise.resolve(body.json),
  } as Response
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function renderGate() {
  return render(
    <PairingGate>
      <div>the studio</div>
    </PairingGate>,
  )
}

describe('PairingGate', () => {
  it('in Tauri is a pass-through and never asks', () => {
    isTauri.mockReturnValue(true)
    renderGate()

    // The desktop is the host machine, not a device to pair; its windows must
    // not spend a round trip learning that.
    expect(screen.getByText('the studio')).toBeTruthy()
    expect(readPairingState).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows an unpaired device the pairing screen and nothing else', async () => {
    isTauri.mockReturnValue(false)
    readPairingState.mockResolvedValue(false)
    renderGate()

    await waitFor(() => expect(screen.getByText('Pair this device')).toBeTruthy())
    // Nothing of the studio is behind the screen for an unpaired device —
    // not even a promise about it.
    expect(screen.queryByText('the studio')).toBeNull()
  })

  it('shows a paired device the studio', async () => {
    isTauri.mockReturnValue(false)
    readPairingState.mockResolvedValue(true)
    renderGate()

    await waitFor(() => expect(screen.getByText('the studio')).toBeTruthy())
    expect(screen.queryByText('Pair this device')).toBeNull()
  })

  it('renders a page served by something else exactly as it always did', async () => {
    isTauri.mockReturnValue(false)
    readPairingState.mockResolvedValue(null)
    renderGate()

    await waitFor(() => expect(screen.getByText('the studio')).toBeTruthy())
    expect(screen.queryByText('Pair this device')).toBeNull()
  })

  it('sends the code to the pairing route as typed, and lets the studio through on success', async () => {
    isTauri.mockReturnValue(false)
    readPairingState.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    fetchMock.mockResolvedValue(aResponse({ ok: true, status: 200, json: { paired: true } }))
    vi.stubGlobal('fetch', fetchMock)
    renderGate()

    await waitFor(() => expect(screen.getByLabelText('Pairing code')).toBeTruthy())
    // Lowercase and a space: what the person typed, not what the PC shows.
    // The listener normalises; the client stays out of that.
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'ab3 45x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/pairing',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: 'ab3 45x' }) }),
      )
    )
    // The cookie is already set, so the gate asks again instead of reloading,
    // and the studio mounts for the first time as a paired device.
    await waitFor(() => expect(screen.getByText('the studio')).toBeTruthy())
    expect(readPairingState).toHaveBeenCalledTimes(2)
  })

  it("shows the listener's own refusal, verbatim", async () => {
    isTauri.mockReturnValue(false)
    readPairingState.mockResolvedValue(false)
    const sentence = 'That pairing code is not valid. Check the code Studio is showing.'
    fetchMock.mockResolvedValue(aResponse({ ok: false, status: 401, json: { error: sentence } }))
    vi.stubGlobal('fetch', fetchMock)
    renderGate()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Pair' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'WRONG0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }))

    await waitFor(() => expect(screen.getByText(sentence)).toBeTruthy())
    // And the person is still on the screen, with the field they can fix.
    expect(screen.queryByText('the studio')).toBeNull()
  })

  it('tells a browser that cannot reach the PC at all', async () => {
    isTauri.mockReturnValue(false)
    readPairingState.mockResolvedValue(false)
    fetchMock.mockRejectedValue(new TypeError('network down'))
    vi.stubGlobal('fetch', fetchMock)
    renderGate()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Pair' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'ABC234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }))

    await waitFor(() => expect(screen.getByText(/could not be reached/)).toBeTruthy())
  })

  it('refuses to submit an empty field', async () => {
    isTauri.mockReturnValue(false)
    readPairingState.mockResolvedValue(false)
    vi.stubGlobal('fetch', fetchMock)
    renderGate()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Pair' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Pair' }).disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})