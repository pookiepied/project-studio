import { Icons } from '@/components/icons'
import { MenuItem, MenuSeparator } from '@/components/primitives'
import { copyText } from '@/lib/clipboard'
import { useNavigation } from '@/stores/navigation'

/**
 * The app's action list, written once.
 *
 * Two menus offer these actions — the right-click menu and the selection
 * menu — and they must never drift apart, because they are not two features:
 * they are the same verbs, summoned two ways. Before this existed as a shared
 * component, "Ask about this" and "New conversation" were copy-pasted between
 * trigger handlers, which is exactly the shape in which one of them quietly
 * changes and the other doesn't.
 *
 * The contents turn on a selection: with text selected the list is about the
 * text (copy it, widen it, ask about it); the app verbs follow either way, so
 * the menu is never a dead end when the selection vanishes between opening
 * and reading.
 */

export function ActionItems({
  selection,
  target,
  close,
}: {
  /** The selected text, captured when the menu opened. Empty for app-only. */
  readonly selection: string
  /** Where the selection lives, so "Select all" widens within its own reply. */
  readonly target: HTMLElement | null
  readonly close: () => void
}) {
  const { goHome, setPaletteOpen, openSettings } = useNavigation()

  // Widens within the block the selection started in, never the whole
  // document: "select all" on one reply that quietly grabs four others is a
  // surprise, and surprises in a destructive-adjacent verb are how text gets
  // lost. The roots are the selectable surfaces — prose, the field, a page.
  const selectAll = () => {
    const root = target?.closest('.studio-prose, .studio-selectable, .studio-scroll-inset')
    const active = window.getSelection()
    if (!active || !root) return
    const range = document.createRange()
    range.selectNodeContents(root)
    active.removeAllRanges()
    active.addRange(range)
  }

  return (
    <>
      {selection ? (
        <>
          <MenuItem
            icon={<Icons.copy />}
            onSelect={() => {
              void copyText(selection)
              close()
            }}
          >
            Copy
          </MenuItem>
          {/* Deliberately does not close: selecting all is usually the first
              half of copy, and dismissing the menu between the two halves
              forces the right-click (or the drag) all over again. */}
          <MenuItem icon={<Icons.check />} onSelect={selectAll}>
            Select all
          </MenuItem>
          <MenuItem
            icon={<Icons.newChat />}
            onSelect={() => {
              goHome()
              close()
            }}
          >
            Ask about this
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}

      <MenuItem
        icon={<Icons.newChat />}
        onSelect={() => {
          goHome()
          close()
        }}
      >
        New conversation
      </MenuItem>
      <MenuItem
        icon={<Icons.reload />}
        onSelect={() => {
          close()
          window.location.reload()
        }}
      >
        Reload interface
      </MenuItem>
      <MenuItem
        icon={<Icons.command />}
        hint="Ctrl K"
        onSelect={() => {
          setPaletteOpen(true)
          close()
        }}
      >
        Search
      </MenuItem>

      <MenuSeparator />
      <MenuItem
        icon={<Icons.settings />}
        onSelect={() => {
          openSettings()
          close()
        }}
      >
        Settings
      </MenuItem>
    </>
  )
}
