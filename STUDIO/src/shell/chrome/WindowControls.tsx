import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { cn } from '@/lib/cn'
import { closeWindow, isTauri, toggleMaximizeWindow } from '@/platform/tauri'

/** Family A's diagonal arrows. There is no minimize: the reference has none. */
export function MaximizeControl() {
  if (!isTauri()) return null
  return (
    <IconButton label="Maximize" size="header" tooltipSide="bottom" onClick={() => void toggleMaximizeWindow()}>
      <Icons.expand size="header" />
    </IconButton>
  )
}

/** The grey circle at the end of every header. */
export function CloseControl() {
  if (!isTauri()) return null
  return (
    <IconButton
      label="Close"
      size="header"
      tooltipSide="bottom"
      onClick={() => void closeWindow()}
      className="bg-window-close hover:bg-window-close"
    >
      <Icons.windowClose size="sm" />
    </IconButton>
  )
}

/** Both, for the windows that have nothing else to put between them. */
export function WindowControls({ className }: { className?: string }) {
  if (!isTauri()) return null
  return (
    <div className={cn('flex shrink-0 items-center gap-1.5', className)}>
      <MaximizeControl />
      <CloseControl />
    </div>
  )
}
