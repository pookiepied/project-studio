import { useEffect, useSyncExternalStore } from 'react'
import { captureState, startClientCapture, subscribeCapture } from '@/platform/diagnostics/transport'
import { useNavigation } from '@/stores/navigation'
import { isTauri } from '@/platform/tauri'

/** Capture stays visible outside Settings, including detached and paired views. */
export function CaptureMonitor() {
  const capture = useSyncExternalStore(subscribeCapture, captureState)
  const { openSettings } = useNavigation()
  useEffect(() => startClientCapture(), [])
  if (capture.status !== 'recording' && !(capture.status === 'unavailable' && capture.lastKnownRecording)) return null
  return <div role="status" className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md border bg-surface px-3 py-1.5 text-caption shadow-sm">
    <span>{capture.status === 'recording' ? 'Local diagnostics recording' : 'Recording status unavailable'}</span>
    {isTauri() ? <button className="underline" onClick={() => openSettings('diagnostics')}>Manage</button> : null}
  </div>
}
