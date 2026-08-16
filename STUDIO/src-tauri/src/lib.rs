mod window;

use tauri::{AppHandle, Manager};

/// The frontend invokes this once it has mounted and painted. The window starts
/// hidden (`visible: false` in tauri.conf.json) so the user never sees a blank
/// or half-rendered frame.
#[tauri::command]
async fn app_ready(app: AppHandle) -> Result<(), String> {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.set_focus();
  }
  Ok(())
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
    .invoke_handler(tauri::generate_handler![app_ready])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
