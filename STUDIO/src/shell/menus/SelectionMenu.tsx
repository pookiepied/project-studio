import { useEffect, useRef, useState } from 'react'
import { fieldAt } from '@/lib/field'
import { transcriptOf } from '@/shell/menus/ActionItems'
import { EDGE_PADDING, FloatingMenu, type FloatingPlacement } from '@/shell/menus/FloatingMenu'

/**
 * The toolbar over selected transcript text: Copy and Reply.
 *
 * ---- When it appears -------------------------------------------------------
 *
 * On the pointer *rising* from a drag, on a double-click, and on the keys that
 * make a selection. Never during the drag itself, because a toolbar chasing a
 * moving caret is noise, and never from a click that selected nothing. Only in a
 * transcript: text selected on any other page is usually being copied, and
 * Ctrl C or a right-click serves that without anything rising over the page.
 *
 * ---- Where it appears ------------------------------------------------------
 *
 * Centred over the selection's own rectangle: above it where there is room,
 * below it at the top of the window. The transcript scrolls under the top fades,
 * so the toolbar follows its selection on scroll rather than being dismissed by
 * it, and leaves with the text when the text leaves the window.
 *
 * ---- When it leaves --------------------------------------------------------
 *
 * Any click outside it, Escape, or the selection collapsing. A right-click on
 * the selection leaves it up, since this is what a right-click would offer.
 */

/** Reads the current selection into menu state, or null if there is nothing to act on. */
function readSelection(): { rect: DOMRect; selection: string; target: HTMLElement | null } | null {
  const active = window.getSelection()
  if (!active || active.isCollapsed || active.rangeCount === 0) return null

  const text = active.toString().trim()
  if (!text) return null

  // A selection inside a text field is the field's: it has its own
  // right-click menu, and a panel rising over every shift-arrow while
  // someone edits a sentence is the menu chasing the caret.
  if (fieldAt(document.activeElement)) return null

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

    if (transcriptOf(read.target) === null) {
      setPlacement(null)
      return
    }

    setPlacement({
      x: read.rect.left, y: read.rect.top, anchor: read.rect,
      origin: 'bottom left', kind: 'selection',
      selection: read.selection, target: read.target,
    })
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
      if (event.button === 2) return
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

    // Right-clicking the selection keeps the toolbar; right-clicking elsewhere
    // ends the selection, and `place` finds nothing.
    const onContextMenu = () => place()

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
