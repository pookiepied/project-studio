import { useEffect, useRef, useState } from 'react'

import { Icons } from '@/components/icons'
import { Button } from '@/components/primitives'
import { onComputerIndicatorChanged, onComputerIndicatorStatus, onComputerStopResult, requestComputerStop } from '@/platform/tauri'
import { newUuid } from '@/lib/id'

/**
 * The pill that says Studio is using the computer (ADR 0055 §7).
 *
 * ---- What this is ----------------------------------------------------------
 *
 * While a model drives the desktop the person needs one honest sign of it,
 * because the pointer moves and keys are pressed by something that is not
 * them. Other tools shrink the app and paint a coloured border around the
 * screen. Neither is done here: a border is hard on the eyes and a resize
 * makes the app look broken. This is a second window instead -- frameless,
 * transparent, always on top, never focused, at the top centre of the display
 * -- with nothing painted in it but this pill. The desktop looks exactly as
 * it did, plus one small sign that says who is at the keyboard.
 *
 * ---- Why a window and not a corner of the app --------------------------------
 *
 * The app may be behind the window the model is working in, or minimised, or
 * on another display. The sign has to be where the person is looking, which
 * is the screen, not the app.
 *
 * ---- Stop --------------------------------------------------------------------
 *
 * The one control. It goes through the native side rather than the store,
 * because this window mounts none of the app's stores: it asks Rust, which
 * tells the window that owns the conversation, which stops the driver and the
 * run. The pill is then taken down by that window, so the button only says
 * "Stopping" and does not pretend to know the result.
 *
 * ---- The window label --------------------------------------------------------
 *
 * Built as `computer-indicator`, listed in `capabilities/default.json`. The
 * size below is the one Rust gives the window (`COMPUTER_INDICATOR_SIZE`).
 */
export function ComputerIndicatorWindow() {
  const [stopping, setStopping] = useState(false)
  const [mode, setMode] = useState('active')
  const [stopFailed, setStopFailed] = useState(false)
  const pending = useRef<string | null>(null)
  useEffect(() => {
    let live = true
    let unlisten: (() => void) | undefined
    let unlistenStatus: (() => void) | undefined
    let unlistenResult: (() => void) | undefined
    void onComputerIndicatorChanged(() => {
      if (!live) return
      pending.current = null
      setStopping(false)
      setStopFailed(false)
    }).then((stop) => {
      if (live) unlisten = stop
      else stop()
    })
    void onComputerIndicatorStatus((status) => { if (live) setMode(status) }).then((stop) => {
      if (live) unlistenStatus = stop
      else stop()
    })
    void onComputerStopResult((requestId, failed) => {
      if (!live || requestId !== pending.current || !failed) return
      pending.current = null
      setStopping(false)
      setStopFailed(true)
    }).then((stop) => { if (live) unlistenResult = stop; else stop() })
    return () => { live = false; pending.current = null; unlisten?.(); unlistenStatus?.(); unlistenResult?.() }
  }, [])

  const stop = () => {
    const requestId = newUuid()
    pending.current = requestId
    setStopFailed(false)
    setStopping(true)
    void requestComputerStop(requestId).catch(() => {
      if (pending.current !== requestId) return
      pending.current = null
      setStopping(false)
      setStopFailed(true)
    })
  }

  return (
    <div className="flex h-full w-full items-start justify-center bg-transparent p-1">
      <div
        role="status"
        aria-live="polite"
        className="flex h-10 w-max min-w-[300px] max-w-full items-center gap-2 rounded-full border border-hairline bg-surface pl-3 pr-1.5 text-caption font-medium text-foreground shadow-sm [&_button]:text-foreground"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"><Icons.computerUse /></span>
        <span className="min-w-0 flex-1 truncate leading-4">{stopFailed ? 'Could not stop. Try again.' : mode === 'paused' ? 'Computer work is paused' : mode === 'demonstrating' ? 'You have computer control' : mode === 'stopping' ? 'Releasing computer control' : 'Studio is using your computer'}</span>
        <Button size="xs" variant="ghost" className="h-7 w-[5.5em] px-0 leading-4" busy={stopping || mode === 'stopping'} onClick={stop}>
          {stopping || mode === 'stopping' ? 'Stopping' : 'Stop'}
        </Button>
      </div>
    </div>
  )
}
