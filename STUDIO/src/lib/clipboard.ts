/**
 * Copy text, reporting whether it worked.
 *
 * The caller needs the answer because every copy control in the app confirms
 * in place, and a control that flashes "Copied" when the write was refused is
 * worse than one that does nothing.
 *
 * The async clipboard API is the first choice, and it is not always there:
 * `navigator.clipboard` exists only on secure origins, and a phone reading
 * Studio over the LAN (ADR 0050) is on plain `http://` by design. There the
 * deprecated `execCommand('copy')` is the one remaining way a page can write
 * the clipboard without a permission prompt. It reads the current selection,
 * so the fallback holds the text in a textarea it renders off-screen for the
 * length of one call and takes away again.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return copyThroughSelection(text)
  }
}

/**
 * The selection round-trip, used only when the clipboard API refused or
 * never existed. `false` when even this is unavailable — a non-DOM
 * environment, a browser that has finally removed the command — which the
 * caller shows as a copy that did not happen, because it did not.
 */
function copyThroughSelection(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  // Off-screen but rendered: a textarea that is not rendered cannot be
  // selected, and an unselected one copies nothing.
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  const previous = document.activeElement
  textarea.select()
  let copied: boolean
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  textarea.remove()
  if (previous instanceof HTMLElement) previous.focus({ preventScroll: true })
  return copied
}
