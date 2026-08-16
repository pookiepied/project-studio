/**
 * Copy text, reporting whether it worked.
 *
 * The caller needs the answer because every copy control in the app confirms
 * in place, and a control that flashes "Copied" when the write was refused is
 * worse than one that does nothing.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
