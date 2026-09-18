//! The clipboard's text, read by Studio itself.
//!
//! The field menu's Paste used to read the clipboard through the webview
//! (`navigator.clipboard.readText`), with `permissions.rs` answering the
//! permission request WebView2 raises. WebView2 refuses the read anyway:
//! `readText` rejects with "Read permission denied" and the Permissions API
//! reports `clipboard-read` as denied, inside a click gesture or outside one,
//! with the handler attached and answering ALLOW. Ctrl+V never asks, because
//! it is the textarea's own paste, so the menu's row was the only paste in
//! the app that read nothing.
//!
//! So the read moves to where Studio already trusts itself: a command, the
//! same seam harness requests leave through. The Win32 clipboard is opened,
//! read as Unicode text, and closed in one call. Text is the only format
//! read on purpose - the row is Paste in a text field, and a file or an
//! image on the clipboard is the composer's own drop-and-paste path, not
//! this one.

/// `CF_UNICODETEXT`: the one clipboard format this reads. The constant lives
/// behind the `Win32_System_Ole` feature, a feature bought for one number.
#[cfg(windows)]
const UNICODE_TEXT: u32 = 13;

/// How many times to try opening the clipboard, and how long between tries.
/// Another process holds the clipboard for the length of its own read or
/// write, which is milliseconds; a handful of short waits outlasts every
/// honest holder, and giving up after them is the answer for a dishonest one.
#[cfg(windows)]
const OPEN_ATTEMPTS: u32 = 5;
#[cfg(windows)]
const OPEN_RETRY_DELAY_MS: u64 = 10;

/// The clipboard's text, or the empty string when it holds none.
///
/// Empty rather than an error for "no text": a paste with nothing to paste
/// inserts nothing, and a menu row that raised an error for an empty
/// clipboard would be scolding the person for their clipboard. An error is
/// kept for the clipboard that could not be opened at all.
#[tauri::command]
pub fn read_clipboard_text() -> Result<String, String> {
  read()
}

#[cfg(windows)]
fn read() -> Result<String, String> {
  use windows::Win32::Foundation::HGLOBAL;
  use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, IsClipboardFormatAvailable};
  use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};

  open_clipboard()?;

  // Everything between the open and the close is one block, so the close
  // runs on every path out of it - a clipboard left open blocks every other
  // application's copy until this process exits.
  let text = (|| {
    if unsafe { IsClipboardFormatAvailable(UNICODE_TEXT) }.is_err() {
      return Ok(String::new());
    }
    let handle = unsafe { GetClipboardData(UNICODE_TEXT) }
      .map_err(|error| format!("the clipboard's text could not be fetched: {error}"))?;
    let global = HGLOBAL(handle.0);
    let start = unsafe { GlobalLock(global) };
    if start.is_null() {
      return Err("the clipboard's text could not be locked for reading".to_string());
    }
    let text = unsafe { wide_string_at(start.cast::<u16>()) };
    // Unlock reports the lock count as an "error" of zero, which is not one.
    let _ = unsafe { GlobalUnlock(global) };
    Ok(text)
  })();

  let _ = unsafe { CloseClipboard() };
  text
}

#[cfg(windows)]
fn open_clipboard() -> Result<(), String> {
  use windows::Win32::System::DataExchange::OpenClipboard;

  let mut last = None;
  for attempt in 0..OPEN_ATTEMPTS {
    match unsafe { OpenClipboard(None) } {
      Ok(()) => return Ok(()),
      Err(error) => last = Some(error),
    }
    if attempt + 1 < OPEN_ATTEMPTS {
      std::thread::sleep(std::time::Duration::from_millis(OPEN_RETRY_DELAY_MS));
    }
  }
  Err(format!(
    "the clipboard is held by another application: {}",
    last.map(|error| error.to_string()).unwrap_or_default()
  ))
}

/// The NUL-terminated UTF-16 string at `start`, as owned UTF-8.
///
/// Callers guarantee `start` points at a locked `CF_UNICODETEXT` block, which
/// the clipboard terminates with NUL. Unpaired surrogates become U+FFFD
/// rather than failing the whole paste over one bad code unit.
#[cfg(windows)]
unsafe fn wide_string_at(start: *const u16) -> String {
  let mut length = 0usize;
  while unsafe { *start.add(length) } != 0 {
    length += 1;
  }
  let units = unsafe { std::slice::from_raw_parts(start, length) };
  String::from_utf16_lossy(units)
}

#[cfg(not(windows))]
fn read() -> Result<String, String> {
  Err("the clipboard is read by the desktop shell on Windows only".to_string())
}
