//! Native window setup for the STUDIO shell.

use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// How long a window has to sit still before its place is written down, so a
/// drag costs one write when it ends rather than one per pixel.
const PLACEMENT_QUIET: Duration = Duration::from_millis(600);

/// Visibility stays out of this: a window that has not been shown yet, or has
/// gone to the tray, must not be remembered as hidden.
fn placement_flags() -> StateFlags {
  StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

/// Writes window placement when it changes.
///
/// The window-state plugin writes only on a clean exit, and a clean exit is the
/// rare case here: close-to-tray means the close button only hides the window,
/// and closing the console `start.bat` opened ends the process outright. Either
/// way everything since the last clean exit was lost, so Studio came back at a
/// size long since changed, and "Reset to default size" did not survive a launch.
pub struct PlacementWriter(Sender<()>);

impl PlacementWriter {
  pub fn changed(&self, window: &tauri::Window) {
    // Only windows a person arranges. The indicator and the overlay are moved by
    // the app, often enough that the quiet period would never arrive.
    let label = window.label();
    if label == "main" || label.starts_with("conversation-") {
      let _ = self.0.send(());
    }
  }
}

pub fn remember_placement(app: &AppHandle) -> PlacementWriter {
  let (changes, heard) = channel();
  let app = app.clone();
  std::thread::spawn(move || {
    while settled(&heard, PLACEMENT_QUIET) {
      // On the main thread because the plugin holds its cache lock while it asks
      // each window for its state. From here that question waits on the main
      // thread, which may itself be waiting on that lock to record a move.
      let saving = app.clone();
      let queued = app.run_on_main_thread(move || {
        if let Err(error) = saving.save_window_state(placement_flags()) {
          log::warn!("Window: could not save its size and position: {error}");
        }
      });
      if queued.is_err() {
        return;
      }
    }
  });
  PlacementWriter(changes)
}

/// Waits for a change and then for the changes to stop. False once nothing can
/// report a change any more.
fn settled(changes: &Receiver<()>, quiet: Duration) -> bool {
  if changes.recv().is_err() {
    return false;
  }
  loop {
    match changes.recv_timeout(quiet) {
      Ok(()) => {}
      Err(RecvTimeoutError::Timeout) => return true,
      Err(RecvTimeoutError::Disconnected) => return false,
    }
  }
}

#[cfg(test)]
mod placement_tests {
  use super::*;

  const QUIET: Duration = Duration::from_millis(20);

  #[test]
  fn a_burst_of_changes_settles_once() {
    let (changes, heard) = channel();
    for _ in 0..50 {
      changes.send(()).unwrap();
    }
    assert!(settled(&heard, QUIET));
    assert!(heard.try_recv().is_err(), "the whole burst is consumed by one wait");
  }

  #[test]
  fn nothing_is_written_when_nothing_can_change() {
    let (changes, heard) = channel::<()>();
    drop(changes);
    assert!(!settled(&heard, QUIET));
  }

  #[test]
  fn a_change_the_app_closes_on_is_not_a_settled_one() {
    let (changes, heard) = channel();
    changes.send(()).unwrap();
    drop(changes);
    assert!(!settled(&heard, QUIET));
  }
}

/// Remove DWM's rounding and frame border, so the OS window has no visible
/// shape of its own. The visible shape is the CSS panel inset inside it
/// (`--window-radius` in styles/layout.css), which draws its own shadow.
///
/// `DWMWCP_ROUND` must stay off: on this transparent window it fills the whole
/// rectangle with a pale translucent layer, which turns the panel's clear margin
/// into a visible box.
#[cfg(target_os = "windows")]
pub fn clear_native_edge(window: &WebviewWindow) {
  use windows::Win32::Graphics::Dwm::{
    DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
    DWM_WINDOW_CORNER_PREFERENCE, DwmSetWindowAttribute,
  };

  if let Ok(hwnd) = window.hwnd() {
    let corner_preference = DWMWCP_DONOTROUND;
    let border_color_none: u32 = 0xFFFFFFFE;
    unsafe {
      let _ = DwmSetWindowAttribute(
        hwnd,
        DWMWA_WINDOW_CORNER_PREFERENCE,
        &corner_preference as *const DWM_WINDOW_CORNER_PREFERENCE as *const core::ffi::c_void,
        core::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
      );
      let _ = DwmSetWindowAttribute(
        hwnd,
        DWMWA_BORDER_COLOR,
        &border_color_none as *const u32 as *const core::ffi::c_void,
        core::mem::size_of::<u32>() as u32,
      );
    }
  }
}

#[cfg(not(target_os = "windows"))]
pub fn clear_native_edge(_window: &tauri::WebviewWindow) {}
