import { useState } from 'react'

import { StudioMark } from '@/components/brand'
import { Button } from '@/components/primitives'
import { requestComputerStop } from '@/platform/tauri'

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

  const stop = () => {
    setStopping(true)
    void requestComputerStop()
  }

  return (
    <div className="flex h-full w-full items-start justify-center bg-transparent p-1">
      <div
        role="status"
        aria-live="polite"
        className="flex h-10 items-center gap-3 rounded-full border border-hairline bg-surface pl-3 pr-1.5 text-foreground shadow-panel"
      >
        <StudioMark busy size={14} className="text-foreground" />
        <span className="text-ui whitespace-nowrap">Studio is using your computer</span>
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-foreground/70 motion-safe:animate-pulse"
        />
        <Button size="xs" variant="ghost" busy={stopping} onClick={stop}>
          {stopping ? 'Stopping' : 'Stop'}
        </Button>
      </div>
    </div>
  )
}
