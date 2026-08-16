/**
 * Strip the webview's own chrome.
 *
 * A Tauri app is a browser engine wearing a native costume, and the costume
 * slips in two places: right-click offers Back, Reload, View Source and Inspect
 * -- commands from a document viewer, several of which do visible damage in an
 * app with no address bar -- and the developer shortcuts open a panel over the
 * window with no way back that a user would recognise.
 *
 * The two are split on purpose:
 *
 * - The right-click menu is blocked in **every** environment, including dev. A
 *   native menu that offers Inspect or View Source is the one piece of browser
 *   chrome in the window, and showing it alongside `ActionsMenu`'s custom menu
 *   is two menus at once. The custom menu is what the app offers instead.
 *
 * - The developer keyboard shortcuts (devtools, view-source, reload) are
 *   blocked only in production. Dev needs F12 / Ctrl+Shift+I / Ctrl+R / F5, and
 *   a desktop reload that blanks the window is the very hazard this guard
 *   exists to stop outside of it.
 */
export function suppressWebviewChrome(): () => void {
  const onContextMenu = (event: MouseEvent) => event.preventDefault()

  document.addEventListener('contextmenu', onContextMenu)

  if (import.meta.env.DEV) {
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase()
    const inspect = (event.ctrlKey || event.metaKey) && event.shiftKey && (key === 'i' || key === 'j' || key === 'c')
    const viewSource = (event.ctrlKey || event.metaKey) && key === 'u'
    // Reload is blocked because in a frameless app it looks like the window
    // died: the whole surface blanks and returns with the conversation reset.
    const reload = ((event.ctrlKey || event.metaKey) && key === 'r') || key === 'f5'

    if (key === 'f12' || inspect || viewSource || reload) event.preventDefault()
  }

  document.addEventListener('keydown', onKeyDown)
  return () => {
    document.removeEventListener('contextmenu', onContextMenu)
    document.removeEventListener('keydown', onKeyDown)
  }
}
