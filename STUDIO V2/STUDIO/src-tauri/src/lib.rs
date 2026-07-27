use tauri::{AppHandle, Manager};

/// The frontend invokes this once it has mounted and painted. The window
/// starts hidden (`visible: false` in tauri.conf.json) so the user never
/// sees a blank or half-rendered frame; this is the same startup contract
/// as the previous STUDIO shell.
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
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![app_ready])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
