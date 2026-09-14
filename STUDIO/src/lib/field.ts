/**
 * A text field the event landed in, or null.
 *
 * Shared by the two menus and the platform layer, each of which asks the
 * same question of a right-click: is this a place where text is typed? A
 * read-only input is not - it shows a value and takes none.
 */
export function fieldAt(target: EventTarget | null): HTMLTextAreaElement | HTMLInputElement | null {
  if (!(target instanceof HTMLElement)) return null
  const field = target.closest('textarea, input')
  if (field instanceof HTMLTextAreaElement) return field
  if (field instanceof HTMLInputElement && !field.readOnly) return field
  return null
}
