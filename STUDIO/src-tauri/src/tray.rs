use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  App, AppHandle, Manager,
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

/// Builds the notification-area icon and its menu.
///
/// Two items, because a tray menu is not a place to put features. `Show
/// Studio` is the same action as clicking the icon, kept because a
/// left-click is not discoverable and on some Windows configurations the
/// icon lives behind the overflow chevron where clicking it is awkward.
/// `Quit` is the one thing the tray must offer that nothing else can: with
/// close-to-tray on, the window's close button no longer ends the app, and
/// an app a person cannot quit is worse than one with no tray at all.
///
/// The icon is the window icon rather than a second asset. A tray glyph
/// wants its own drawing at 16px and this is not that; it is the same mark
/// scaled, which is honest about being a placeholder and costs nothing to
/// replace later.
pub fn install(app: &App) -> tauri::Result<()> {
  let show = MenuItem::with_id(app, "show", "Show Studio", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Quit Studio", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&show, &quit])?;

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
