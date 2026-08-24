import { SHELL } from '@/design/tokens'
import { closeWindow, isTauri, minimizeWindow, toggleMaximizeWindow } from '@/platform/tauri'

type LightKind = 'close' | 'minimize' | 'maximize'

/*
 * Window controls, monochrome.
 *
 * The macOS red, amber and green are the obvious thing to draw here and this
 * app does not draw them. They would be the only saturated pixels in the entire
 * interface, which makes them the first thing the eye lands on every time the
 * window opens — three bright dots in a corner, louder than anything the user
 * came to read, and borrowed from another company's shell besides.
 *
 * What survives their removal is what was carrying the meaning anyway: three
 * dots, in that order, in that corner. Position is the mnemonic; colour was
 * decoration. They rest at low contrast and come up on hover, which is the
 * right amount of attention for a control used twice a session.
 */
const LIGHTS: ReadonlyArray<{
  kind: LightKind
  label: string
  glyph: string
  action: () => Promise<void>
}> = [
  { kind: 'close', label: 'Close', glyph: 'M1 1l4 4M5 1L1 5', action: closeWindow },
  { kind: 'minimize', label: 'Minimize', glyph: 'M1 3h4', action: minimizeWindow },
  { kind: 'maximize', label: 'Zoom', glyph: 'M1 3h4M3 1v4', action: toggleMaximizeWindow },
]

export function TrafficLights() {
  if (!isTauri()) return null

  return (
    // No `data-tauri-drag-region` here or on the buttons: Tauri tests the event
    // target for the attribute rather than walking up the tree, so children of
    // the dragging strip are click targets by default. Setting it to `false`
    // would be worse than useless — React emits the string "false" and
    // `hasAttribute` reports it as present.
    <div className="group/lights flex shrink-0 items-center" style={{ gap: SHELL.trafficLight.gap }}>
      {LIGHTS.map(({ kind, label, glyph, action }) => (
        <button
          key={kind}
          type="button"
          onClick={() => void action()}
          aria-label={label}
          className={[
            'flex items-center justify-center rounded-full',
            'bg-foreground/15 transition-colors duration-base',
            'group-hover/lights:bg-foreground/30 hover:!bg-foreground/45 active:!bg-foreground/60',
          ].join(' ')}
          style={{ width: SHELL.trafficLight.size, height: SHELL.trafficLight.size }}
        >
          <svg
            viewBox="0 0 6 6"
            aria-hidden
            className="size-full p-[2.5px] opacity-0 transition-opacity duration-base group-hover/lights:opacity-100"
          >
            <path
              d={glyph}
              className="stroke-background"
              strokeWidth="1.2"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      ))}
    </div>
  )
}
