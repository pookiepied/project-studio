import { resolveHarnessAddress } from '@/platform/harness/connection'
import { harnessTransport } from '@/platform/harness/transport'
import { isRecord } from '@/lib/guards'
import { clientObservations, recordClientObservation } from './events'
import { syncNativeCapture } from './native'

export interface ClientCaptureState {
  readonly status: 'off' | 'recording' | 'unavailable'
  readonly lastKnownRecording: boolean
}
let state: ClientCaptureState = { status: 'off', lastKnownRecording: false }
const listeners = new Set<() => void>()
export const captureState = () => state
export function subscribeCapture(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function publish(status: ClientCaptureState['status']): void {
  if (state.status === status) return
  state = { status, lastKnownRecording: status === 'unavailable' ? state.lastKnownRecording : status === 'recording' }
  for (const listener of listeners) listener()
}

/** Only operational events leave the window; the host decides the active epoch. */
export function startClientCapture(): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: AbortController | undefined
  const unavailable = async () => {
    if (stopped) return
    clientObservations.configure(null)
    publish('unavailable')
    // Rust independently reads the owner's policy, including a missing owner.
    await syncNativeCapture(false)
  }
  const poll = async () => {
    let sending = 0
    try {
      const address = await resolveHarnessAddress()
      if (stopped) return
      if (address === null) { await unavailable(); return }
      const controller = new AbortController()
      pending = controller
      let timeout = setTimeout(() => controller.abort(), 3000)
      try {
        const headers = { authorization: `Bearer ${address.credential}`, 'content-type': 'application/json' }
        const base = address.baseUrl.replace(/\/+$/, '')
        const policy = await harnessTransport(`${base}/api/observations/policy`, { headers, cache: 'no-store', signal: controller.signal })
        if (stopped) return
        const body: unknown = policy.ok ? await policy.json() : null
        if (stopped) return
        if (!isRecord(body) || typeof body.enabled !== 'boolean' || typeof body.captureId !== 'string') {
          await unavailable(); return
        }
        clearTimeout(timeout)
        const wasEnabled = clientObservations.enabled
        clientObservations.configure(body.enabled ? body.captureId : null)
        const nativeAvailable = await syncNativeCapture(body.enabled)
        if (stopped) return
        publish(body.enabled ? 'recording' : 'off')
        if (body.enabled && !wasEnabled) recordClientObservation({ name: 'client.window', phase: 'start', attributes: { stage: 'capture_attached' } })
        if (body.enabled && !nativeAvailable) recordClientObservation({ name: 'client.window', phase: 'progress', attributes: { failure: 'native-capture-unavailable' } })
        const batch = clientObservations.take()
        if (batch !== null) {
          timeout = setTimeout(() => controller.abort(), 3000)
          sending = batch.events.length
          const result = await harnessTransport(`${base}/api/observations`, {
            method: 'POST', headers, body: JSON.stringify(batch), signal: controller.signal,
          })
          if (!result.ok) clientObservations.discard(sending)
          sending = 0
        }
      } finally { clearTimeout(timeout); pending = undefined }
    } catch {
      if (stopped) return
      clientObservations.discard(sending)
      await unavailable()
    } finally {
      if (!stopped) timer = setTimeout(() => { void poll() }, 3000)
    }
  }
  void poll()
  return () => {
    stopped = true
    clearTimeout(timer)
    pending?.abort()
    clientObservations.configure(null)
  }
}
