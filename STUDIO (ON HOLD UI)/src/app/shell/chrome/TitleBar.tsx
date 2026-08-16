import { BranchSwitcher } from '@/app/shell/chrome/BranchSwitcher'
import { LocationTitle } from '@/app/shell/chrome/LocationTitle'
import { PanelToggle } from '@/app/shell/chrome/PanelToggle'
import { SearchTrigger } from '@/app/shell/chrome/SearchTrigger'
import { WindowTrafficLights } from '@/app/shell/chrome/WindowTrafficLights'
import { SHELL } from '@/app/shell/shellConfig'
import { StudioMark } from '@/components/brand/StudioMark'
import { isTauri, toggleMaximizeWindow } from '@/platform/tauri/window'

/**
 * The window's one title bar.
 *
 * Everything that used to float over the app in `position: fixed` lives here as
 * a flex child: window controls, both rail toggles, the location, the branch,
 * and the search field. That is the whole fix for the overlap. The previous
 * shell placed those controls by arithmetic against the viewport while each
 * panel independently laid out its own header — two layout systems describing
 * the same pixels, and they disagreed. One flex row cannot disagree with
 * itself.
 *
 * It is also the window's drag surface, replacing the invisible 5px strip at
 * the top edge. A 44px bar is a target you can actually grab, and double-click
 * to zoom lands where a Mac user already expects it. Interactive children opt
 * out of dragging individually — otherwise a click that moves two pixels
 * becomes a window drag instead of a button press.
 *
 * Layout, left to right:
 *
 *   ●●● ⬗ ⿴   Project ▸ Conversation ····· ⌥branch   [Search ⌘K]   ⿴
 *   └lights┘│ └left toggle┘ └───location───┘         └────right group────┘
 *           └ the mark
 *
 * The mark is the app's one persistent brand placement. It sits here rather
 * than at the top of the navigator because the navigator collapses (⌘B), and a
 * brand that blinks in and out is not one. It also does the job the hairline
 * divider used to — separating the window's controls from the app's own — and
 * unlike that divider it still reads outside Tauri, where there are no traffic
 * lights and this corner would otherwise be empty.
 *
 * It is deliberately not a button. Home is already reachable from the location
 * breadcrumb and from ⌘K, and a third route to the same place is a thing to
 * explain rather than a thing to use. Staying inert also keeps it part of the
 * drag region instead of punching a hole in it.
 *
 * The gap between location and the right group is elastic and is the drag
 * handle in practice: it is the one part of the bar with nothing in it.
 */
export function TitleBar() {
  return (
    <header
      data-tauri-drag-region={isTauri() || undefined}
      onDoubleClick={isTauri() ? () => void toggleMaximizeWindow() : undefined}
      /* Transparent, and no bottom rule: it sits *on* the tray alongside the
         panels rather than being a fourth panel stacked above them. A border
         here would cut the window in half and undo the floating look. */
      className="relative z-30 flex shrink-0 items-center gap-2 select-none"
      style={{
        height: SHELL.titleBar.height,
        paddingLeft: SHELL.titleBar.paddingLeft,
        paddingRight: SHELL.titleBar.paddingRight,
      }}
    >
      <WindowTrafficLights />

      {/* Chrome, not content: it holds at the muted weight so it sits behind
          the location in the reading order instead of competing with it. */}
      <StudioMark size={14} className="shrink-0 text-muted-foreground" />

      <PanelToggle side="left" />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <LocationTitle />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <BranchSwitcher />
        <SearchTrigger />
        <PanelToggle side="right" />
      </div>
    </header>
  )
}
