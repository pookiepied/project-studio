import { useEffect, useRef, useState } from 'react'
import { EDGE_PADDING, FloatingMenu, MENU_WIDTH, type FloatingPlacement } from '@/shell/menus/FloatingMenu'

/**
 * The selection menu.
 *
 * ---- What it is ------------------------------------------------------------
 *
 * The same action list the right-click menu carries (`ActionItems` — one
 * list, two ways to summon it), offered the moment text is selected rather
 * than after a right-click. Selecting a phrase and acting on it is one
 * gesture in the user's head; routing it through a second gesture was the
 * app making its vocabulary harder to reach than its contents.
 *
 * ---- When it appears -------------------------------------------------------
 *
 * On the pointer *rising* from a drag, on a double-click, and on the keys
 * that make a selection (Shift, the arrows, Home and friends). Never during
 * the drag itself — a menu chasing a moving caret is noise — and never from
 * a click that selected nothing.
 *
 * ---- Where it appears ------------------------------------------------------
 *
 * Centred over the selection's own rectangle: above it where there is room,
 * below it at the top of the window, growing from whichever edge it hugs. The
 * transcript scrolls under the top fades, so the menu follows its selection
 * on scroll rather than being dismissed by it — a menu that vanishes because
 * the page moved is a menu that punished the user for reading.
 *
 * ---- When it leaves --------------------------------------------------------
 *
 * Any click outside it, Escape, the right-click menu opening, or the
 * selection collapsing. "Select all" deliberately does not dismiss it: that
 * verb is usually the first half of Copy.
 */

const MENU_HEIGHT = 252
const SELECTION_GAP = 8

/** Reads the current selection into menu state, or null if there is nothing to act on. */
function readSelection(): { rect: DOMRect; selection: string; target: HTMLElement | null } | null {
  const active = window.getSelection()
  if (!active || active.isCollapsed || active.rangeCount === 0) return null

  const text = active.toString().trim()
  if (!text) return null

  const rect = active.getRangeAt(0).getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null

  // The anchor is usually a text node; the element around it is what the
  // verbs need (closest-selectable lookups live on elements).
  const node = active.anchorNode
  const target =
    node instanceof HTMLElement ? node : (node?.parentElement instanceof HTMLElement ? node.parentElement : null)
  return { rect, selection: text, target }
}

export function SelectionMenu() {
  const menuRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<FloatingPlacement | null>(null)
  // The latest placement for listeners that must not close over stale state.
  const openRef = useRef(false)
  openRef.current = placement !== null
  // Set by the Escape handler, consumed by the next key-up.
  const suppressNextKeyUp = useRef(false)

  const close = () => setPlacement(null)

  const place = () => {
    const read = readSelection()
    if (!read || menuRef.current?.contains(read.target)) {
      setPlacement(null)
      return
    }

    // A selection that has scrolled out of the window takes its menu with
    // it. Following it off screen is loyalty to a coordinate, not to the
    // user: the menu exists to act on text the user is looking at, and text
    // that has left the viewport is text they have scrolled past. Reselecting
    // summons it again, anchored to where the text now is.
    if (read.rect.top >= window.innerHeight - EDGE_PADDING || read.rect.bottom <= EDGE_PADDING) {
      setPlacement(null)
      return
    }

    const centred = read.rect.left + read.rect.width / 2 - MENU_WIDTH / 2
    const x = Math.min(Math.max(centred, EDGE_PADDING), window.innerWidth - MENU_WIDTH - EDGE_PADDING)

    const above = read.rect.top - MENU_HEIGHT - SELECTION_GAP
    if (above >= EDGE_PADDING) {
      setPlacement({ x, y: above, origin: 'bottom left', selection: read.selection, target: read.target })
    } else {
      setPlacement({
        x,
        // Floored as well as clamped: on a window shorter than the menu the
        // clamp alone goes negative, which is how a menu once landed at a
        // negative coordinate and became unclickable.
        y: Math.min(
          Math.max(read.rect.bottom + SELECTION_GAP, EDGE_PADDING),
          Math.max(EDGE_PADDING, window.innerHeight - MENU_HEIGHT - EDGE_PADDING),
        ),
        origin: 'top left',
        selection: read.selection,
        target: read.target,
      })
    }
  }

  useEffect(() => {
    // A pointer rising is the end of a drag or a double-click. Both are the
    // native gestures that make a selection, so both are the menu's cue.
    const onPointerUp = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      place()
    }

    // A pointer falling outside the menu ends its turn — including the start
    // of a fresh drag, which will reopen the menu wherever the new selection
    // lands. Inside the menu, the rows handle their own clicks.
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      close()
    }

    // A key rising over a live selection. Unfiltered on purpose: a selection
    // can only exist because the user made it, so any key-up that finds one
    // is a cue — and filtering by key was wrong twice in practice. Typing
    // into the composer collapses the selection and finds nothing, and a
    // synthetic Ctrl+A can deliver its key-up as the modifier alone, which a
    // key filter silently drops.
    const onKeyUp = () => {
      if (suppressNextKeyUp.current) {
        suppressNextKeyUp.current = false
        return
      }
      if (menuRef.current?.contains(document.activeElement)) return
      place()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (!openRef.current) return
      event.stopPropagation()
      // The dismissal is the whole gesture; the key-up that follows it must
      // not bring the menu back over the selection it just dismissed.
      suppressNextKeyUp.current = true
      close()
    }

    // While open, the menu tracks its selection: "Select all" widens it, and
    // the text Copy will use must be the text now selected. A collapsed
    // selection means the user clicked or typed it away — the menu goes too.
    const onSelectionChange = () => {
      if (!openRef.current) return
      place()
    }

    // The transcript scrolls; the selection moves with it. Repositioning on
    // scroll (captured, so nested scrollers are covered) keeps the menu
    // pinned to its phrase instead of stranded where the phrase was.
    const onScroll = () => {
      if (!openRef.current) return
      place()
    }

    // The right-click menu supersedes this one; two menus over one selection
    // is a decision the user did not make.
    const onContextMenu = () => close()

    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('contextmenu', onContextMenu)
    return () => {
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('contextmenu', onContextMenu)
    }
  }, [])

  return <FloatingMenu ref={menuRef} placement={placement} label="selection actions" close={close} />
}
