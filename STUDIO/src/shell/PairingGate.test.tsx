/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'

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
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

function renderGate() {
  return render(
    <PairingGate>
      <div>the studio</div>
    </PairingGate>,
  )
}

describe('PairingGate', () => {
  it('returns a revoked browser to pairing on focus', async () => {
    isTauri.mockReturnValue(false)
    readPairingState.mockResolvedValueOnce(true).mockResolvedValue(false)
    renderGate()
    expect(await screen.findByText('the studio')).toBeTruthy()
    fireEvent.focus(window)
    expect(await screen.findByText('Pair this device')).toBeTruthy()
    expect(screen.queryByText('the studio')).toBeNull()
  })

  it('returns a revoked browser to pairing on its status poll', async () => {
    vi.useFakeTimers()
    isTauri.mockReturnValue(false)
    readPairingState.mockResolvedValueOnce(true).mockResolvedValue(false)
    renderGate()
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('the studio')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(screen.getByText('Pair this device')).toBeTruthy()
    expect(screen.queryByText('the studio')).toBeNull()
  })

  it('keeps the browser gated when a successful QR POST did not store its cookie', async () => {
    isTauri.mockReturnValue(false)
    readPairingState.mockResolvedValue(false)
    window.history.replaceState(null, '', '/#pair=ABC234')
    fetchMock.mockResolvedValue(aResponse({ ok: true, status: 200, json: { paired: true } }))
    vi.stubGlobal('fetch', fetchMock)
    renderGate()
    expect(await screen.findByText(/Allow cookies for Studio/)).toBeTruthy()
    expect(screen.queryByText('the studio')).toBeNull()
  })
  it('submits a QR code once in StrictMode and removes it from the URL', async () => {
    isTauri.mockReturnValue(false)
    readPairingState.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    window.history.replaceState(null, '', '/?view=chat#pair=ABC234')
    fetchMock.mockImplementation(async () => {
      expect(window.location.hash).toBe('')
      return aResponse({ ok: true, status: 200, json: { paired: true } })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<StrictMode><PairingGate><div>the studio</div></PairingGate></StrictMode>)
    expect(await screen.findByText('the studio')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/pairing', expect.objectContaining({ body: JSON.stringify({ code: 'ABC234' }) }))
    expect(window.location.search).toBe('?view=chat')
  })

  it('keeps an expired QR on the pairing screen with manual entry available', async () => {
    isTauri.mockReturnValue(false)
    readPairingState.mockResolvedValue(false)
    window.history.replaceState(null, '', '/#pair=OLD234')
    fetchMock.mockResolvedValue(aResponse({ ok: false, status: 401, json: { error: 'Use a new code.' } }))
    vi.stubGlobal('fetch', fetchMock)
    renderGate()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Use a new code.')
    expect(screen.getByLabelText('Pairing code')).toBeTruthy()
    expect(screen.queryByText('the studio')).toBeNull()
  })

  it('does not consume a QR when the browser is already paired', async () => {
    isTauri.mockReturnValue(false)
    readPairingState.mockResolvedValue(true)
    window.history.replaceState(null, '', '/#pair=ABC234')
    vi.stubGlobal('fetch', fetchMock)
    renderGate()
    expect(await screen.findByText('the studio')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
  })
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
    // `getByRole` typed at the call: the disabled flag belongs to the button
    // element, and an `as` cast here is what lint would call unnecessary.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pair' }).disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
