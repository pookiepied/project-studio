import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './window'

/**
 * The desktop clipboard's text, read by Rust (`read_clipboard_text` in
 * `src-tauri/src/clipboard.rs`), or null outside the desktop shell.
 *
 * The webview cannot do this read itself. WebView2 refuses
 * `navigator.clipboard.readText` with "Read permission denied" whatever the
 * permission handler in `permissions.rs` answers, inside a click gesture and
 * outside one, and the field menu's Paste read nothing for as long as it
 * asked. Null, not the empty string, for "not the desktop": the caller has a
 * browser clipboard to fall back to, and an empty clipboard is a different
 * answer from no clipboard.
 */
export async function readDesktopClipboardText(): Promise<string | null> {
  if (!isTauri()) return null
  return invoke<string>('read_clipboard_text')
}
