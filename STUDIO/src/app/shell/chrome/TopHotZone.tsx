import { SHELL } from '@/app/shell/shellConfig'
import { isTauri, toggleMaximizeWindow } from '@/platform/tauri/window'

/**
 * The frameless window's drag surface: an invisible strip spanning the full
 * top edge. Double-click toggles maximize. Renders nothing visually — the
 * same hot-zone contract as the previous STUDIO shell.
 */
export function TopHotZone() {
  if (!isTauri()) return null

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={() => void toggleMaximizeWindow()}
      className="fixed inset-x-0 top-0 z-40 select-none"
      style={{ height: SHELL.hotZoneHeight }}
    />
  )
}
