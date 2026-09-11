//! The permission question, answered by Studio itself.
//!
//! WebView2 raises `PermissionRequested` when a page asks for a device, and
//! left to its own devices a Tauri window either stalls the promise - the
//! microphone button that does nothing - or raises Edge's own permission bar
//! inside Studio's frame, a borrowed control in a window that draws its own
//! chrome. This answers for it, on every webview the app creates, through the
//! plugin in `lib.rs` whose only work is calling `attach` from
//! `on_webview_ready`, so no builder can forget it: the microphone on Studio's
//! own origin is allowed, every other kind denied, and a page that asks anyway
//! gets its answer without a prompt. Nothing in the app reads the clipboard
//! through the webview (`lib/clipboard.ts` writes only) and paste is the
//! textarea's own, so the denials cost nothing. Windows's own microphone
//! privacy setting still rules: when it refuses, `getUserMedia` rejects with
//! `NotAllowedError` and the dictation strip's blocked face says so.

/// The hosts this app's own documents come from: the bundled shell
/// (`tauri.localhost`, either scheme) and the dev server the config names
/// (`localhost` / `127.0.0.1`). A remote page served to a phone runs in the
/// phone's browser, so it never appears here.
const OWN_HOSTS: [&str; 3] = ["tauri.localhost", "localhost", "127.0.0.1"];

#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2PermissionRequestedEventArgs;
#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_KIND;
#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_KIND_MICROPHONE;
#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_STATE_ALLOW;
#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_STATE_DENY;
#[cfg(windows)]
use webview2_com::PermissionRequestedEventHandler;
#[cfg(windows)]
use webview2_com::take_pwstr;
#[cfg(windows)]
use windows::core::PWSTR;

/// Grants the microphone to this webview, before any page asks.
///
/// `with_webview` runs on the main thread, where the controller lives. The
/// registration has no matching removal: the handler lives exactly as long as
/// the webview does, which is what the registration token buys no one.
#[cfg(windows)]
pub fn attach(webview: &tauri::Webview) {
  let _ = webview.with_webview(|platform| {
    let core = match unsafe { platform.controller().CoreWebView2() } {
      Ok(core) => core,
      Err(error) => {
        log::warn!(
          "Permissions: the webview gave no WebView2 core, so its microphone falls back to WebView2's own answer: {error}"
        );
        return;
      }
    };
    let mut token: i64 = 0;
    let registration = unsafe {
      core.add_PermissionRequested(
        &PermissionRequestedEventHandler::create(Box::new(|_sender, args| {
          let Some(args) = args else {
            return Ok(());
          };
          answer(&args)
        })),
        &mut token,
      )
    };
    if let Err(error) = registration {
      log::warn!("Permissions: the permission handler could not be attached, so WebView2 answers instead: {error}");
    }
  });
}

#[cfg(not(windows))]
pub fn attach(_webview: &tauri::Webview) {}

#[cfg(windows)]
fn answer(args: &ICoreWebView2PermissionRequestedEventArgs) -> windows::core::Result<()> {
  let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
  unsafe { args.PermissionKind(&mut kind)? };

  // Allow only the microphone, and only from our own documents; everything
  // else is answered, not prompted for. The origin read is the one thing that
  // can fail here, and its failure mode is the generous one: the only
  // document this webview loads is our own, so an unreadable origin means
  // "ours, we just cannot spell it", and a stall is the thing this handler
  // exists to prevent.
  let ours = kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE && {
    let mut uri = PWSTR::null();
    unsafe { args.Uri(&mut uri)? };
    own_document(take_pwstr(uri).as_str())
  };

  unsafe {
    args.SetState(if ours {
      COREWEBVIEW2_PERMISSION_STATE_ALLOW
    } else {
      COREWEBVIEW2_PERMISSION_STATE_DENY
    })
  }
}

/// Whether the URI names one of our own hosts: the authority, with its port
/// and any path, casing, or trailing spelling removed.
#[cfg(windows)]
fn own_document(uri: &str) -> bool {
  let authority = match uri.split_once("://") {
    Some((_, rest)) => rest.split('/').next().unwrap_or(rest),
    // Not a URL this handler recognises; the document is ours regardless.
    None => return true,
  };
  let host = authority.split(':').next().unwrap_or(authority);
  OWN_HOSTS.contains(&host.to_ascii_lowercase().as_str())
}
