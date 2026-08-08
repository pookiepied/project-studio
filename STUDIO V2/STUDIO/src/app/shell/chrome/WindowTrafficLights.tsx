import { SHELL } from '@/app/shell/shellConfig'
import { closeWindow, isTauri, minimizeWindow, toggleMaximizeWindow } from '@/platform/tauri/window'

type LightKind = 'close' | 'minimize' | 'maximize'

/* macOS traffic-light hues — fixed OS-chrome colours, not themeable tokens. */
const LIGHTS: ReadonlyArray<{ kind: LightKind; color: string; label: string; action: () => Promise<void> }> = [
  { kind: 'close', color: '#FF5F57', label: 'Close', action: closeWindow },
  { kind: 'minimize', color: '#FFBD2E', label: 'Minimize', action: minimizeWindow },
  { kind: 'maximize', color: '#28C840', label: 'Zoom', action: toggleMaximizeWindow },
]

/**
 * Permanent custom window controls for the frameless shell, fixed at the
 * top-left over content. Renders nothing in the browser.
 */
export function WindowTrafficLights() {
  if (!isTauri()) return null

  return (
    <div
      className="pointer-events-auto fixed top-0 z-50 flex items-center"
      style={{
        left: SHELL.trafficLight.left,
        gap: SHELL.trafficLight.gap,
        height: SHELL.trafficLight.height,
      }}
    >
      {LIGHTS.map(({ kind, color, label, action }) => (
        <button
          key={kind}
          type="button"
          onClick={() => void action()}
          aria-label={label}
          className="rounded-full ring-1 ring-white/10 transition-opacity hover:opacity-80 active:opacity-60"
          style={{ width: SHELL.trafficLight.size, height: SHELL.trafficLight.size, backgroundColor: color }}
        />
      ))}
    </div>
  )
}
