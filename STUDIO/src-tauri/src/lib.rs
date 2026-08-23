mod harness;
mod services;
mod window;

use harness::{HarnessEndpointView, HarnessStatus, HarnessSupervisor};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

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

/// Start the Harness if it is not already up, and hand back where it is.
///
/// The view, not the endpoint: the bearer stays in Rust, spent only by
/// `service_fetch`. Nothing returns it any more.
///
/// The supervisor is managed directly rather than behind a `Mutex`. It is
/// already `Clone` over an `Arc<Mutex<Inner>>` and every method takes `&self`,
/// so an outer lock guarded nothing the inner one did not -- it only added
/// three `lock().map_err(...)` calls and a poisoning case that could never be
/// reached through them.
#[tauri::command]
fn get_harness_endpoint(
  supervisor: tauri::State<'_, HarnessSupervisor>,
) -> Result<HarnessEndpointView, String> {
  supervisor.start().map(HarnessEndpointView::from)
}

#[tauri::command]
fn restart_harness(
  supervisor: tauri::State<'_, HarnessSupervisor>,
) -> Result<HarnessEndpointView, String> {
  supervisor.restart().map(HarnessEndpointView::from)
}

/// What the Harness is doing, including a start that already failed.
///
/// This returns a status rather than an `Option<HarnessEndpoint>` because the
/// eager start in `run()` happens on a background thread before any window
/// exists: a failure there had no caller to return to and ended in
/// `log::error!`. `HarnessStatus` distinguishes "failed, and here is why" from
/// "nothing has started yet", which is the difference between something the UI
/// can render and a line in a log file.
#[tauri::command]
fn get_harness_status(
  supervisor: tauri::State<'_, HarnessSupervisor>,
) -> Result<HarnessStatus, String> {
  Ok(supervisor.status())
}

/// One seam for side systems: the webview names a service and a path, and
/// Rust decides everything else -- above all the credential, which the
/// supervisor holds and this attaches. See `services.rs` for why that is an
/// enum with one arm and not a registry.
#[tauri::command]
async fn service_fetch(
  supervisor: tauri::State<'_, HarnessSupervisor>,
  service: services::ServiceId,
  path: String,
  init: services::ServiceRequestInit,
) -> Result<services::SerializedResponse, services::ServiceError> {
  services::service_fetch(&supervisor, service, path, init).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let supervisor = HarnessSupervisor::new();

  // Eager, and off Tauri's setup thread, so the Harness is starting while the
  // window is still being built rather than after the first request for it.
  // A failure here is not fatal and is no longer only logged: the supervisor
  // keeps it, and `get_harness_status` reports it once a webview exists to ask.
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
    .manage(supervisor)
    // Remembers size and position across launches. A desktop app that reopens
    // at a fixed size every time is one the user has to re-arrange every time,
    // and on a second monitor that is the difference between usable and not.
    // `resetWindowSize` in the frontend is the way back to the default.
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_store::Builder::default().build())
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
    // Closing the main window ends the app, and the Harness is a child process
    // that would otherwise be left holding its port. Both events are handled:
    // `Destroyed` fires as the window goes, `ExitRequested`/`Exit` as the run
    // loop unwinds, and `shutdown_all` is idempotent, so whichever arrives
    // first does the work.
    //
    // Only `main`. Detached conversation windows are destroyed whenever the
    // user closes one, and they share this Harness -- reacting to their label
    // would kill it out from under the window the user is still working in.
    .on_window_event(|window, event| {
      if matches!(event, WindowEvent::Destroyed) && window.label() == "main" {
        if let Some(sup) = window.try_state::<HarnessSupervisor>() {
          sup.shutdown_all();
        }
      }
    })
    .invoke_handler(tauri::generate_handler![
      app_ready,
      open_conversation_window,
      get_harness_endpoint,
      restart_harness,
      get_harness_status,
      service_fetch
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(move |app_handle, event| {
      if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
        if let Some(sup) = app_handle.try_state::<HarnessSupervisor>() {
          sup.shutdown_all();
        }
      }
    });
}
