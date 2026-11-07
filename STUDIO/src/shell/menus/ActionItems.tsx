import { useEffect, useState, type ReactNode } from 'react'
import { Icons } from '@/components/icons'
import { writeQuote } from '@/features/chat/composer/drafts'
import { copyText, readClipboardText } from '@/lib/clipboard'
import { fieldAt } from '@/lib/field'
import { cn } from '@/lib/cn'

/**
 * The app's one contextual surface: a small horizontal toolbar.
 *
 * It holds only what can be done to the thing under the pointer, and there are
 * two such things:
 *
 *   field      the caret is in a text field, and it was right-clicked. Cut, Copy
 *              and Paste, because the webview's own menu is suppressed and these
 *              are the only way to do them with a mouse.
 *   selection  text is selected. Copy, and Reply when the text is in a
 *              transcript. In a transcript it appears as the pointer rises;
 *              anywhere else, only when asked for with a right-click.
 *
 * Everywhere else a right-click does nothing. It used to open a menu of app
 * verbs, but each of those has a home of its own: the header and Ctrl K. Select
 * all is Ctrl A in a field and on the page, so it is not repeated here.
 *
 * Spelling corrections cannot join it: the webview hands the host the rows of
 * the menu it would have shown, and the spelling rows arrive with their labels
 * empty. The red underline is still the webview's; a misspelt word is retyped.
 */

export type ActionKind = 'field' | 'selection'

/** The conversation whose transcript holds this element, if one does. */
export function transcriptOf(target: HTMLElement | null): string | null {
  return target?.closest<HTMLElement>('[data-transcript]')?.dataset.transcript ?? null
}

export function ActionItems({
  kind,
  selection,
  target,
  close,
}: {
  readonly kind: ActionKind
  /** The selected text, captured when the toolbar opened. */
  readonly selection: string
  /** What summoned it: the field, or the element the selection started in. */
  readonly target: HTMLElement | null
  readonly close: () => void
}) {
  if (kind === 'field') return <FieldItems field={fieldAt(target)} close={close} />

  const conversation = transcriptOf(target)
  return (
    <>
      <Action
        icon={<Icons.copy />}
        onSelect={() => {
          void copyText(selection)
          close()
        }}
      >
        Copy
      </Action>
      {conversation !== null ? (
        <Action
          accent
          icon={<Icons.quote />}
          onSelect={() => {
            writeQuote(conversation, selection)
            close()
          }}
        >
          Reply
        </Action>
      ) : null}
    </>
  )
}

function Action({
  icon,
  accent = false,
  disabled = false,
  onSelect,
  children,
}: {
  icon: ReactNode
  accent?: boolean
  disabled?: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      // The selection is what is being acted on; the press must not end it
      // before the click reads it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={cn('studio-action text-ui font-medium', accent && 'studio-action-accent')}
    >
      {icon}
      {children}
    </button>
  )
}

/**
 * A text field's verbs. Each goes through the field's own editing commands
 * so the field's owner sees an ordinary edit: `insertText` fires the input
 * event a controlled React field listens for, where setting `.value` would
 * change the screen behind React's back.
 *
 * The buttons follow the field's selection while the toolbar is open, so Cut and
 * Copy wake for text selected from the keyboard. `selectionchange` fires for a
 * field's selection as well as the page's, so one listener covers it.
 */
function FieldItems({
  field,
  close,
}: {
  field: HTMLTextAreaElement | HTMLInputElement | null
  close: () => void
}) {
  const selected = useFieldSelection(field)
  const hasSelection = selected.length > 0

  const insert = (text: string) => {
    if (!field) return
    field.focus()
    // Chromium's `insertText` replaces the selection and fires `input`; the
    // fallback does the same by hand for a runtime without it.
    const command = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)
    if (!command) {
      field.setRangeText(text, field.selectionStart ?? 0, field.selectionEnd ?? 0, 'end')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  return (
    <>
      <Action
        icon={<Icons.cut />}
        disabled={!hasSelection}
        onSelect={() => {
          void copyText(selected)
          insert('')
          close()
        }}
      >
        Cut
      </Action>
      <Action
        icon={<Icons.copy />}
        disabled={!hasSelection}
        onSelect={() => {
          void copyText(selected)
          // The caret goes back where it was, or the next Ctrl+A would select
          // the whole window instead of the field's text.
          field?.focus()
          close()
        }}
      >
        Copy
      </Action>
      <Action
        icon={<Icons.paste />}
        onSelect={() => {
          close()
          void readClipboardText().then((text) => {
            if (text) insert(text)
          })
        }}
      >
        Paste
      </Action>
    </>
  )
}

/** The field's selected text, kept current for as long as the caller is mounted. */
function useFieldSelection(field: HTMLTextAreaElement | HTMLInputElement | null): string {
  const [selected, setSelected] = useState(() => selectionOf(field))
  useEffect(() => {
    const onSelectionChange = () => setSelected(selectionOf(field))
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [field])
  return selected
}

function selectionOf(field: HTMLTextAreaElement | HTMLInputElement | null): string {
  return field ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0) : ''
}
