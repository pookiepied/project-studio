import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clientObservations } from './events'
import { captureState, startClientCapture } from './transport'

const mocks = vi.hoisted(() => ({ address: vi.fn(), transport: vi.fn(), native: vi.fn() }))
vi.mock('@/platform/harness/connection', () => ({ resolveHarnessAddress: mocks.address }))
vi.mock('@/platform/harness/transport', () => ({ harnessTransport: mocks.transport }))
vi.mock('./native', () => ({ syncNativeCapture: mocks.native }))

describe('client capture policy lifecycle', () => {
  let stop: (() => void) | undefined
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    clientObservations.configure(null)
    mocks.address.mockResolvedValue({ baseUrl: 'http://host', credential: 'test' })
    mocks.native.mockResolvedValue(true)
  })
  afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers() })

  it('reconciles native policy when the owner address is unavailable', async () => {
    mocks.address.mockResolvedValue(null)
    stop = startClientCapture()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.native).toHaveBeenCalledWith(false)
    expect(captureState().status).toBe('unavailable')
    expect(clientObservations.enabled).toBe(false)
  })

  it('retains the visible recording indication through policy failure and reconciles native capture', async () => {
    mocks.transport.mockResolvedValueOnce(Response.json({ enabled: true, captureId: 'epoch' }))
      .mockResolvedValueOnce(Response.json({ accepted: 1 }))
      .mockRejectedValueOnce(new Error('offline'))
    stop = startClientCapture()
    await vi.advanceTimersByTimeAsync(0)
    expect(captureState().status).toBe('recording')
    await vi.advanceTimersByTimeAsync(3000)
    expect(captureState()).toEqual({ status: 'unavailable', lastKnownRecording: true })
    expect(mocks.native).toHaveBeenLastCalledWith(false)
  })

  it('reconciles native policy on a refused policy response', async () => {
    mocks.transport.mockResolvedValue(new Response(null, { status: 503 }))
    stop = startClientCapture()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.native).toHaveBeenCalledWith(false)
    expect(clientObservations.enabled).toBe(false)
  })

  it('does not let an unmounted poll disable a replacement capture', async () => {
    let rejectOld: ((error: Error) => void) | undefined
    mocks.transport.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject }))
    stop = startClientCapture()
    await vi.advanceTimersByTimeAsync(0)
    stop()
    mocks.transport.mockResolvedValueOnce(Response.json({ enabled: true, captureId: 'new-epoch' }))
      .mockResolvedValueOnce(Response.json({ accepted: 1 }))
    stop = startClientCapture()
    await vi.advanceTimersByTimeAsync(0)
    rejectOld?.(new Error('old abort'))
    await vi.advanceTimersByTimeAsync(0)
    expect(clientObservations.enabled).toBe(true)
    expect(captureState().status).toBe('recording')
  })
})
