import { SHELL } from '@/app/shell/shellConfig'
import { closeWindow, isTauri, minimizeWindow, toggleMaximizeWindow } from '@/platform/tauri/window'

type LightKind = 'close' | 'minimize' | 'maximize'

/*
 * macOS traffic-light hues. These are the one place in the app that carries a
 * hue at all: they are OS chrome, not product surface, and a monochrome close
 * button reads as a decoration rather than a control. Everything else obeys
 * the monochrome rule in `index.css`.
 */
const LIGHTS: ReadonlyArray<{
  kind: LightKind
  color: string
  label: string
  glyph: string
  action: () => Promise<void>
}> = [
  { kind: 'close', color: '#FF5F57', label: 'Close', glyph: 'M1 1l4 4M5 1L1 5', action: closeWindow },
  { kind: 'minimize', color: '#FEBC2E', label: 'Minimize', glyph: 'M1 3h4', action: minimizeWindow },
  { kind: 'maximize', color: '#28C840', label: 'Zoom', glyph: 'M1 3h4M3 1v4', action: toggleMaximizeWindow },
]

/**
 * Window controls, laid out inline as the first children of the title bar.
 *
 * They used to be `position: fixed` at a hardcoded offset, which meant every
 * other element in the top row had to hardcode a matching offset to dodge them
 * — and the sidebar's `pl-16` was doing exactly that, in the browser too, where
 * these do not render at all. As a flex child the group simply occupies its
 * width and the bar lays out around it.
 *
 * Glyphs appear on group hover, the way they do on macOS: the dots are enough
 * to identify the controls at rest, and the symbols are for the moment you are
 * actually aiming at one.
 */
export function WindowTrafficLights() {
  if (!isTauri()) return null

  return (
    // No `data-tauri-drag-region` here, and none on the buttons: Tauri tests
    // the event target for the attribute rather than walking up the tree, so
    // children of the dragging title bar are click targets by default. Setting
    // it to `false` would be worse than useless — React would emit the string
    // "false" and `hasAttribute` would report it as present.
    <div
      className="group/lights flex shrink-0 items-center"
      style={{ gap: SHELL.trafficLight.gap }}
    >
      {LIGHTS.map(({ kind, color, label, glyph, action }) => (
        <button
          key={kind}
          type="button"
          onClick={() => void action()}
          aria-label={label}
          className="flex items-center justify-center rounded-full ring-1 ring-black/10 transition-opacity duration-150 active:opacity-70 dark:ring-white/10"
          style={{
            width: SHELL.trafficLight.size,
            height: SHELL.trafficLight.size,
            backgroundColor: color,
          }}
        >
          <svg
            viewBox="0 0 6 6"
            aria-hidden
            className="size-full p-[2.5px] opacity-0 transition-opacity duration-150 group-hover/lights:opacity-100"
          >
            <path
              d={glyph}
              stroke="rgba(0,0,0,0.55)"
              strokeWidth="1.1"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      ))}
    </div>
  )
}
