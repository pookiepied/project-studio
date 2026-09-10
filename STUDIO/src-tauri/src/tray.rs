use std::net::SocketAddr;

use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  App, AppHandle, Manager, Wry,
};

/// The argument autostart passes, and the only reason the app ever starts
/// without a window.
///
/// A login item that throws a window in front of someone every time they sign
/// in is a login item they disable within a week. Started this way the app is
/// the tray icon and nothing else until asked for.
pub const HIDDEN_FLAG: &str = "--hidden";

/// Whether this launch was asked to stay out of the way.
pub fn launched_hidden() -> bool {
  std::env::args().any(|arg| arg == HIDDEN_FLAG)
}

/// Brings the main window back, from wherever it went.
///
/// Three separate states get someone here and all three have to be handled or
/// the tray looks broken: the window may be hidden (close-to-tray, or an
/// autostart launch that never showed one), minimised (`show` alone leaves it
/// in the taskbar), or simply behind something else. Unminimising a window
/// that was never minimised is a no-op, so the sequence is safe to run in
/// every case rather than branching on a state that can change underneath it.
pub fn reveal_main(app: &AppHandle) {
  let Some(window) = app.get_webview_window("main") else {
    return;
  };
  let _ = window.unminimize();
  let _ = window.show();
  let _ = window.set_focus();
}

/// The tray's one line about other devices, held so it can be rewritten.
///
/// ADR 0050 §3.8: while the machine is reachable, the tray says so. The line
/// is a menu item that cannot be chosen, because it is a statement and not a
/// command - there is nothing sensible for a click on "reachable at
/// studio.local:4747" to do that the settings screen does not do better. It
/// is managed state so the commands that start and stop the listener can
/// reach it without the tray module knowing when those happen.
pub struct TrayState {
  reachable: MenuItem<Wry>,
}

/// The tray line while nothing is open to other devices.
const REACHABLE_OFF: &str = "Not open to other devices";

/// Rewrites the tray's statement about other devices, and the tooltip with
/// it, so a glance at the icon answers "is my machine reachable?" without
/// opening anything.
///
/// Every write is best effort. The tray is an indication, and a tray that
/// could not be updated is a log line rather than a failed switch.
pub fn reflect_remote(app: &AppHandle, address: Option<SocketAddr>) {
  let line = match address {
    Some(address) => format!("Open to other devices on port {}", address.port()),
    None => REACHABLE_OFF.to_owned(),
  };
  if let Some(state) = app.try_state::<TrayState>() {
    if let Err(error) = state.reachable.set_text(&line) {
      log::warn!("Tray: could not rewrite the other-devices line: {error}");
    }
  }
  if let Some(tray) = app.tray_by_id("main") {
    let tooltip = match address {
      Some(_) => format!("Studio — {line}"),
      None => "Studio".to_owned(),
    };
    if let Err(error) = tray.set_tooltip(Some(tooltip)) {
      log::warn!("Tray: could not rewrite the tooltip: {error}");
    }
  }
}

/// Builds the notification-area icon and its menu.
///
/// Two actions, because a tray menu is not a place to put features. `Show
/// Studio` is the same action as clicking the icon, kept because a
/// left-click is not discoverable and on some Windows configurations the
/// icon lives behind the overflow chevron where clicking it is awkward.
/// `Quit` is the one thing the tray must offer that nothing else can: with
/// close-to-tray on, the window's close button no longer ends the app, and
/// an app a person cannot quit is worse than one with no tray at all.
///
/// Between them, one statement: whether the machine is open to other
/// devices. It is not an action and is drawn as one that cannot be chosen;
/// see `TrayState`.
///
/// The icon is the window icon rather than a second asset. A tray glyph
/// wants its own drawing at 16px and this is not that; it is the same mark
/// scaled, which is honest about being a placeholder and costs nothing to
/// replace later.
pub fn install(app: &App) -> tauri::Result<()> {
  let show = MenuItem::with_id(app, "show", "Show Studio", true, None::<&str>)?;
  let reachable = MenuItem::with_id(app, "reachable", REACHABLE_OFF, false, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Quit Studio", true, None::<&str>)?;
  let menu = Menu::with_items(
    app,
    &[
      &show,
      &PredefinedMenuItem::separator(app)?,
      &reachable,
      &PredefinedMenuItem::separator(app)?,
      &quit,
    ],
  )?;
  app.manage(TrayState { reachable });

  let mut builder = TrayIconBuilder::with_id("main")
    .tooltip("Studio")
    .menu(&menu)
    // Windows opens the menu on right-click by default and would otherwise
    // open it on left-click too, which would swallow the click that is
    // supposed to raise the window.
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "show" => reveal_main(app),
      // `exit` rather than closing the window: the window's own close
      // handler may be routed to hide, and asking it to close would put us
      // straight back in the tray. The run loop's `Exit` arm is what stops
      // the Harness child, and it runs on this path.
      "quit" => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      // Only the release of a left click. `Down` fires first and acting on
      // both would raise the window twice; other buttons belong to the menu.
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        reveal_main(tray.app_handle());
      }
    });

  if let Some(icon) = app.default_window_icon() {
    builder = builder.icon(icon.clone());
  }

  builder.build(app)?;
  Ok(())
}
