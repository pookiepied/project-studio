import { Icons } from '@/components/icons'
import { MenuItem, MenuSeparator } from '@/components/primitives'
import { writeDraft } from '@/features/chat/composer/drafts'
import { copyText, readClipboardText } from '@/lib/clipboard'
import { useNavigation } from '@/stores/navigation'

/**
 * The app's action lists, written once.
 *
 * Two menus offer these actions - the right-click menu and the selection
 * menu - and they must never drift apart, because they are not two
 * features: they are the same verbs, summoned two ways.
 *
 * Which list depends on what was under the pointer, and each list is only
 * about that thing:
 *
 *   field      the caret is in a text field. Cut, Copy, Paste, Select all -
 *              what a text field does, and nothing the field cannot.
 *   selection  text is selected on the page. Copy it, widen it, or ask
 *              about it in a new conversation.
 *   page       nothing in particular. The app's verbs: a new conversation,
 *              reload, search, settings.
 *
 * The app verbs used to follow the selection verbs under a separator, so a
 * menu about three words also offered to reload the interface. That was the
 * menu hedging against the selection vanishing before it was read, and it
 * made every list the same long list. A menu is about the thing that
 * summoned it; the page verbs are one right-click on the page away.
 */

export type ActionKind = 'field' | 'selection' | 'page'

/** A text field the right-click landed in, or null. */
export function fieldAt(target: EventTarget | null): HTMLTextAreaElement | HTMLInputElement | null {
  if (!(target instanceof HTMLElement)) return null
  const field = target.closest('textarea, input')
  if (field instanceof HTMLTextAreaElement) return field
  if (field instanceof HTMLInputElement && !field.readOnly) return field
  return null
}

export function ActionItems({
  kind,
  selection,
  target,
  close,
}: {
  readonly kind: ActionKind
  /** The selected text, captured when the menu opened. */
  readonly selection: string
  /** Where the menu opened, so "Select all" widens within its own block. */
  readonly target: HTMLElement | null
  readonly close: () => void
}) {
  const { goHome, setPaletteOpen, openSettings } = useNavigation()

  if (kind === 'field') return <FieldItems field={fieldAt(target)} close={close} />

  // Widens within the block the selection started in, never the whole
  // document: "select all" on one reply that quietly grabs four others is a
  // surprise, and surprises in a destructive-adjacent verb are how text gets
  // lost. The roots are the selectable surfaces - prose, the field, a page.
  const selectAll = () => {
    const root = target?.closest('.studio-prose, .studio-selectable, .studio-scroll-inset')
    const active = window.getSelection()
    if (!active || !root) return
    const range = document.createRange()
    range.selectNodeContents(root)
    active.removeAllRanges()
    active.addRange(range)
  }

  if (kind === 'selection') {
    return (
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
          icon={<Icons.askAbout />}
          onSelect={() => {
            // The selection goes with you: quoted into the home composer's
            // draft, which the composer reads when it mounts, with the
            // caret left after it for the question. Before this it went
            // home empty and the person retyped what they had just pointed
            // at.
            writeDraft(null, `${quote(selection)}\n\n`)
            goHome()
            close()
          }}
        >
          Ask about this
        </MenuItem>
      </>
    )
  }

  return (
    <>
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

/** Markdown's quotation, line by line, so a multi-line selection stays one quote. */
function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

/**
 * A text field's verbs. Each goes through the field's own editing commands
 * so the field's owner sees an ordinary edit: `insertText` fires the input
 * event a controlled React field listens for, where setting `.value` would
 * change the screen behind React's back.
 */
function FieldItems({
  field,
  close,
}: {
  field: HTMLTextAreaElement | HTMLInputElement | null
  close: () => void
}) {
  const selected = field ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0) : ''
  const hasSelection = selected.length > 0

  const insert = (text: string) => {
    if (!field) return
    field.focus()
    // Chromium's `insertText` replaces the selection and fires `input`; the
    // fallback does the same by hand for a runtime without it.
    if (!document.execCommand('insertText', false, text)) {
      field.setRangeText(text, field.selectionStart ?? 0, field.selectionEnd ?? 0, 'end')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  return (
    <>
      <MenuItem
        icon={<Icons.cut />}
        disabled={!hasSelection}
        onSelect={() => {
          void copyText(selected)
          insert('')
          close()
        }}
      >
        Cut
      </MenuItem>
      <MenuItem
        icon={<Icons.copy />}
        disabled={!hasSelection}
        onSelect={() => {
          void copyText(selected)
          close()
        }}
      >
        Copy
      </MenuItem>
      <MenuItem
        icon={<Icons.paste />}
        onSelect={() => {
          close()
          void readClipboardText().then((text) => {
            if (text) insert(text)
          })
        }}
      >
        Paste
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<Icons.check />}
        disabled={!field || field.value.length === 0}
        onSelect={() => {
          field?.focus()
          field?.select()
        }}
      >
        Select all
      </MenuItem>
    </>
  )
}
