import { SHELL } from '@/design/tokens'
import { closeWindow, isTauri, minimizeWindow, toggleMaximizeWindow } from '@/platform/tauri'

/** The reference's quiet window controls, in their familiar left-to-right order. */
const LIGHTS = [
  { label: 'Close', glyph: 'M1 1l4 4M5 1L1 5', action: closeWindow },
  { label: 'Minimize', glyph: 'M1 3h4', action: minimizeWindow },
  { label: 'Zoom', glyph: 'M1 3h4M3 1v4', action: toggleMaximizeWindow },
] as const

export function TrafficLights() {
  if (!isTauri()) return null

  return (
    <div role="group" aria-label="Window controls" className="group/lights flex shrink-0 items-center"
      style={{ gap: SHELL.trafficLight.gap }}>
      {LIGHTS.map(({ label, glyph, action }) => (
        <button key={label} type="button" aria-label={label} onClick={() => void action()}
          className="flex items-center justify-center rounded-full bg-foreground/15 transition-colors duration-base group-hover/lights:bg-foreground/30 hover:!bg-foreground/45 active:!bg-foreground/60"
          style={{ width: SHELL.trafficLight.size, height: SHELL.trafficLight.size }}>
          <svg viewBox="0 0 6 6" aria-hidden
            className="size-full p-[2.5px] opacity-0 transition-opacity duration-base group-hover/lights:opacity-100 group-focus-within/lights:opacity-100">
            <path d={glyph} className="stroke-background" strokeWidth="1.2" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      ))}
    </div>
  )
}
