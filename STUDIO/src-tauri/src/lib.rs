mod window;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// The frontend invokes this once it has mounted and painted. Windows start
/// hidden (`visible: false` in tauri.conf.json, and explicitly for detached
/// ones) so the user never sees a blank or half-rendered frame.
///
/// It shows *the calling window* rather than "main". Detached conversation
/// windows run the same frontend and call the same command, and hard-coding the
/// label meant a second window announced itself ready and then never appeared
/// while the main one was re-shown instead.
#[tauri::command]
async fn app_ready(window: tauri::WebviewWindow) -> Result<(), String> {
  let _ = window.show();
  let _ = window.set_focus();
  Ok(())
}

/// Open one conversation in its own window.
///
/// The same frontend bundle with a query parameter, not a second app. The
/// detached window reads it and renders that conversation alone -- no sidebar,
/// no navigation -- which keeps one implementation of the transcript, the
/// composer and the shell rather than a stripped copy that drifts.
///
/// Every window property here is deliberately the same as the main window's:
/// undecorated, transparent, shadowless, and given the DWM rounded corner in
/// the same call. A detached window that looked even slightly different would
/// read as a different application.
#[tauri::command]
async fn open_conversation_window(
  app: AppHandle,
  conversation_id: String,
  title: String,
) -> Result<(), String> {
  let label = format!("conversation-{}", sanitize(&conversation_id));

  // Already open: focus it rather than stacking a second copy. Opening the
  // same conversation twice is a slip, not a request for two windows.
  if let Some(existing) = app.get_webview_window(&label) {
    let _ = existing.unminimize();
    let _ = existing.set_focus();
    return Ok(());
  }

  let url = format!("index.html?conversation={}", urlencoding(&conversation_id));

  let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
    .title(title)
    .inner_size(720.0, 760.0)
    .min_inner_size(420.0, 420.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .visible(false)
    .resizable(true)
    .build()
    .map_err(|error| error.to_string())?;

  window::apply_rounded_corners(&window);
  Ok(())
}

/// Window labels accept a restricted character set; ids are ours but may not be.
fn sanitize(value: &str) -> String {
  value
    .chars()
    .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
    .collect()
}

/// Minimal percent-encoding for the one value that reaches a URL here.
fn urlencoding(value: &str) -> String {
  value
    .chars()
    .map(|c| {
      if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '~' {
        c.to_string()
      } else {
        format!("%{:02X}", c as u32)
      }
    })
    .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Remembers size and position across launches. A desktop app that reopens
    // at a fixed size every time is one the user has to re-arrange every time,
    // and on a second monitor that is the difference between usable and not.
    // `resetWindowSize` in the frontend is the way back to the default.
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      if let Some(main_window) = app.get_webview_window("main") {
        window::apply_rounded_corners(&main_window);
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![app_ready, open_conversation_window])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
