mod harness;
mod window;

use harness::{HarnessEndpoint, HarnessSupervisor};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, RunEvent};

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

#[tauri::command]
fn get_harness_endpoint(
  supervisor: tauri::State<'_, Mutex<HarnessSupervisor>>,
) -> Result<HarnessEndpoint, String> {
  let sup = supervisor.lock().map_err(|e| format!("supervisor lock poisoned: {e}"))?;
  // Start if not running
  sup.start()
}

#[tauri::command]
fn restart_harness(
  supervisor: tauri::State<'_, Mutex<HarnessSupervisor>>,
) -> Result<HarnessEndpoint, String> {
  let sup = supervisor.lock().map_err(|e| format!("supervisor lock poisoned: {e}"))?;
  sup.restart()
}

#[tauri::command]
fn get_harness_status(
  supervisor: tauri::State<'_, Mutex<HarnessSupervisor>>,
) -> Result<Option<HarnessEndpoint>, String> {
  let sup = supervisor.lock().map_err(|e| format!("supervisor lock poisoned: {e}"))?;
  Ok(sup.get_endpoint())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let supervisor = HarnessSupervisor::new();

  // Eager start outside Tauri's async runtime to avoid blocking setup thread.
  // Failures are logged, not fatal — the frontend will surface the error via get_harness_endpoint.
  let eager_supervisor = supervisor.clone();
  std::thread::spawn(move || {
    match eager_supervisor.start() {
      Ok(ep) => log::info!(
        "Harness supervisor: eager start ok pid={} {}:{}",
        ep.pid,
        ep.host,
        ep.port
      ),
      Err(e) => log::error!("Harness supervisor: eager start failed: {e}"),
    }
  });

  tauri::Builder::default()
    .manage(Mutex::new(supervisor.clone()))
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
    .invoke_handler(tauri::generate_handler![
      app_ready,
      get_harness_endpoint,
      restart_harness,
      get_harness_status
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(move |app_handle, event| {
      if let RunEvent::ExitRequested { .. } = event {
        if let Some(sup) = app_handle.try_state::<Mutex<HarnessSupervisor>>() {
          if let Ok(s) = sup.lock() {
            s.shutdown_all();
          }
        }
      }
      if let RunEvent::Exit = event {
        if let Some(sup) = app_handle.try_state::<Mutex<HarnessSupervisor>>() {
          if let Ok(s) = sup.lock() {
            s.shutdown_all();
          }
        }
      }
    });
}
