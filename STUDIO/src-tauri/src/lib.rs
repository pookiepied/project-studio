mod harness;
mod services;
mod tray;
mod window;

use harness::{HarnessEndpointView, HarnessStatus, HarnessSupervisor};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use std::sync::atomic::{AtomicBool, Ordering};

/// Guards the one-shot suppression of the first `app_ready` show when the app
/// was launched by the login item. See `app_ready`.
static MAIN_WINDOW_REVEALED: AtomicBool = AtomicBool::new(false);

/// The preferences file the frontend writes, read here for the one setting
/// that has to be honoured by native code.
const PREFERENCES_FILE: &str = "preferences.json";
const WINDOW_PREFERENCES_KEY: &str = "studio.window";

/// Whether closing the main window should hide it rather than end the app.
///
/// **Defaults to true.** Studio holds running turns, a Harness child and a
/// conversation someone is in the middle of; closing the window is almost
/// never a request to throw that away. The tray is what makes this safe
/// rather than surprising: it carries `Quit Studio`, which is the way out,
/// and the icon is present from launch so the app is visibly still there.
///
/// The settings toggle writes the key either way. Someone who wants the
/// close button to end the app can have that, but it is the choice they make
/// rather than the one they get by accident.
///
/// Read on each close rather than cached at startup, so the toggle takes
/// effect the moment it is flipped instead of at the next launch. A close
/// happens once in a while and this is a small JSON file.
fn close_hides_to_tray(app: &AppHandle) -> bool {
  // The file is read directly rather than through the store plugin.
  //
  // `StoreExt::store()` does not hand native code the instance the webview
  // loaded: it answers with a fresh, empty one, so every read here came back
  // as `None` and every close silently took the default. Measured, not
  // assumed - the empty key list was logged from a running build.
  //
  // Reading the file is also the more honest dependency. This is a small
  // JSON document the frontend owns and saves immediately on every change;
  // native code only needs to look at it, and going through a plugin whose
  // caching rules differ by caller is how the bug above happened.
  //
  // Any failure - no config directory, no file yet, unreadable, malformed -
  // means the same thing as an absent preference. A file that cannot be read
  // is not a reason to start destroying someone's work.
  let Ok(directory) = app.path().app_config_dir() else {
    return CLOSE_TO_TRAY_DEFAULT;
  };
  let Ok(text) = std::fs::read_to_string(directory.join(PREFERENCES_FILE)) else {
    return CLOSE_TO_TRAY_DEFAULT;
  };
  // A byte order mark is stripped before parsing. `serde_json` rejects one
  // outright, and this file is meant to be hand-editable -- the appearance
  // module chose a real file over browser storage precisely so a person could
  // open it. On Windows, opening and saving it is very often how a BOM gets
  // there, and a preference silently reverting because an editor added three
  // invisible bytes is the worst kind of bug to be on the wrong end of.
  serde_json::from_str::<serde_json::Value>(text.trim_start_matches('\u{feff}'))
    .ok()
    .and_then(|document| {
      document
        .get(WINDOW_PREFERENCES_KEY)?
        .get("closeToTray")?
        .as_bool()
    })
    .unwrap_or(CLOSE_TO_TRAY_DEFAULT)
}

const CLOSE_TO_TRAY_DEFAULT: bool = true;

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
  // An autostarted launch stays in the tray. The frontend still mounts and
  // still reports ready -- the Harness starts, the conversation list loads,
  // and showing the window later is instant -- it simply is not put in front
  // of someone who was signing in to do something else.
  //
  // Consumed once. A webview reload calls this again, and a window the person
  // has since opened must not vanish because the process was started hidden
  // an hour ago.
  if window.label() == "main"
    && tray::launched_hidden()
    && !MAIN_WINDOW_REVEALED.swap(true, Ordering::SeqCst)
  {
    return Ok(());
  }
  let _ = window.show();
  let _ = window.set_focus();
  Ok(())
}

/// Quit the whole application — the same verb the tray's Quit item performs.
///
/// Exists for the harness-down page, which replaces the shell: with
/// close-to-tray enabled (`CLOSE_TO_TRAY_DEFAULT`), the window's own close
/// button hides rather than exits, so that page's Quit is the one visible way
/// out that a person who has hidden the tray icon still has. `exit` rather
/// than closing the window, for the same reason the tray item gives: the
/// window's close is interceptable by the hide-to-tray preference, and an
/// exit request runs the graceful stop (`shutdown_all` on `RunEvent::Exit`)
/// instead of racing it.
#[tauri::command]
fn quit_app(app: AppHandle) -> Result<(), String> {
  app.exit(0);
  Ok(())
}

/// Open the harness diagnostic in its own window.
///
/// A window rather than a panel on the page, because the text it shows is a
/// document: the supervisor keeps up to `DIAGNOSTIC_LINES` of what it saw plus
/// the child's whole stdout and stderr, which for a crash is routinely dozens
/// of lines. Inline, that either pushes the page's own controls around or gets
/// squeezed into a box with its own scrollbar, and a scrollbar inside a
/// centred page is the density this app is written to avoid. Given a window it
/// can be resized, kept open beside the app while the cause is fixed, and
/// scrolled without moving anything else.
///
/// Nothing is passed in. The window asks the supervisor for the current
/// failure itself, through the same `get_harness_status` every other surface
/// uses, so there is no copy of the text to go stale and no payload to smuggle
/// a token through.
#[tauri::command]
async fn open_diagnostic_window(app: AppHandle) -> Result<(), String> {
  let label = "diagnostic-harness";

  // One at a time. A second press is someone looking for the window they
  // already opened, not asking for a duplicate of it.
  if let Some(existing) = app.get_webview_window(label) {
    let _ = existing.unminimize();
    let _ = existing.set_focus();
    return Ok(());
  }

  let window = WebviewWindowBuilder::new(
    &app,
    label,
    WebviewUrl::App("index.html?diagnostic=harness".into()),
  )
  .title("Harness diagnostic")
  // Wider than it is tall: these are log lines, and the thing that makes them
  // readable is not having to wrap.
  .inner_size(860.0, 620.0)
  .min_inner_size(480.0, 320.0)
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

/// Open one conversation in its own window.
///
/// The same frontend bundle with a query parameter, not a second app. The
/// detached window reads it and renders that conversation alone — no sidebar,
/// no navigation — which keeps one implementation of the transcript, the
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
/// so an outer lock guarded nothing the inner one did not — it only added
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

/// What the Harness is doing, including a start that already failed and one
/// still in flight.
///
/// This returns a status rather than an `Option<HarnessEndpoint>` because the
/// eager start in `run()` happens on a background thread before any window
/// exists: a failure there had no caller to return to and ended in
/// `log::error!`. `HarnessStatus` distinguishes "failed, and here is why" from
/// "nothing has started yet" — which is the difference between something the
/// UI can render and a line in a log file — and answers `starting` promptly
/// during a spawn rather than blocking behind it.
#[tauri::command]
fn get_harness_status(
  supervisor: tauri::State<'_, HarnessSupervisor>,
) -> Result<HarnessStatus, String> {
  Ok(supervisor.status())
}

/// One seam for side systems: the webview names a service and a path, and
/// Rust decides everything else — above all the credential, which the
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

/// The same seam, streaming: the webview additionally names the offset it
/// last saw, and events arrive over the channel as they happen — each
/// carrying the offset to resume from, so any interruption is answered by
/// re-invoking this rather than by losing the run (ADR 0045). The
/// credential stays in Rust exactly as `service_fetch` holds it.
///
/// `stream_id` is chosen by the webview and is what makes the stream
/// cancellable within the session: switching conversations or closing a pane
/// must stop the old read promptly, not when a heartbeat happens to notice.
/// See `services::stream_control` for the registry behind it.
// Same reason as the function it wraps: each argument is one name the
// webview sends, and folding them would move the contract out of the
// invoke boundary that matches on it.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn service_stream(
    supervisor: tauri::State<'_, HarnessSupervisor>,
    streams: tauri::State<'_, std::sync::Arc<services::StreamRegistry>>,
    service: services::ServiceId,
    path: String,
    init: services::ServiceRequestInit,
    offset: String,
    stream_id: String,
    channel: tauri::ipc::Channel<services::StreamEvent>,
) -> Result<(), services::ServiceError> {
    services::service_stream(
        &supervisor,
        &streams,
        service,
        path,
        init,
        offset,
        &stream_id,
        channel,
    )
    .await
}

/// Cancels one live stream by the id its reader chose. Idempotent by
/// construction: an unknown id, a stream that already finished, and a cancel
/// sent twice all find nothing to do and succeed quietly (ADR 0045's rule is
/// untouched here — this stops READING a run, never the run itself; aborting
/// work is Flue's `POST /agents/:name/:id/abort`, and only ever called on
/// purpose).
#[tauri::command]
fn service_stream_cancel(
    streams: tauri::State<'_, std::sync::Arc<services::StreamRegistry>>,
    stream_id: String,
) -> Result<(), String> {
    streams.cancel(&stream_id);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let supervisor = HarnessSupervisor::new();
  // The registry behind `service_stream_cancel`: which live streams the
  // webviews may ask Rust to stop reading. Shared by every window, since a
  // detached conversation window owns streams exactly as the main one does.
  let stream_registry = std::sync::Arc::new(services::StreamRegistry::default());

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

  // The supervisor tells the webview what happens to the Harness as it
  // happens — starting, started (the view, never the token), stopped,
  // failed, restarting — instead of the frontend having to poll for all of
  // it. Attached here because emission needs an app handle; events raised
  // before this point, notably the eager start's `harness-starting`, go to
  // no listener, which costs nothing: the webview's first look is a status
  // call, not an event backlog.
  let lifecycle_supervisor = supervisor.clone();

  tauri::Builder::default()
    .manage(supervisor)
    .manage(stream_registry)
    // Remembers size and position across launches. A desktop app that reopens
    // at a fixed size every time is one the user has to re-arrange every time,
    // and on a second monitor that is the difference between usable and not.
    // `resetWindowSize` in the frontend is the way back to the default.
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_store::Builder::default().build())
    // The directory picker (`pickDirectory` in the frontend's window boundary):
    // the only dialog the app opens, so the capability grants only
    // `dialog:allow-open` - the same enumerated-grant rule the store entry
    // follows, because a capability nothing needs is a standing invitation.
    .plugin(tauri_plugin_dialog::init())
    // Must be registered before anything that could take time: the whole
    // point is for the losing process to hand over and exit quickly, and the
    // callback below runs in the process that already owns the app.
    //
    // The argv of the second launch is deliberately ignored except for the
    // hidden flag. A launch someone performed by hand -- a shortcut, the Start
    // menu -- means "show me Studio", and the only launch that does not is the
    // login item, which never reaches here because it is the first one.
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      tray::reveal_main(app);
    }))
    // The login item, registered with the flag that keeps it quiet. Passing
    // the argument at registration time is what makes an autostarted launch
    // distinguishable from a deliberate one.
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      Some(vec![tray::HIDDEN_FLAG]),
    ))
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      lifecycle_supervisor.attach_lifecycle_emitter(app.handle().clone());
      tray::install(app)?;
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
    // user closes one, and they share this Harness — reacting to their label
    // would kill it out from under the window the user is still working in.
    .on_window_event(|window, event| {
      // Close-to-tray, when the person has asked for it. The window is kept
      // and hidden rather than destroyed, so reopening it from the tray is
      // instant and the Harness child and every running turn survive -- which
      // is the entire reason someone turns this on.
      //
      // Only `main`. A detached conversation window has no tray presence and
      // hiding one would strand it: nothing in the app could bring it back.
      if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" && close_hides_to_tray(window.app_handle()) {
          api.prevent_close();
          let _ = window.hide();
          return;
        }
      }
      if matches!(event, WindowEvent::Destroyed) && window.label() == "main" {
        if let Some(sup) = window.try_state::<HarnessSupervisor>() {
          sup.shutdown_all();
        }
      }
    })
    .invoke_handler(tauri::generate_handler![
      app_ready,
      open_conversation_window,
      open_diagnostic_window,
      quit_app,
      get_harness_endpoint,
      restart_harness,
      get_harness_status,
      service_fetch,
      service_stream,
      service_stream_cancel
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
