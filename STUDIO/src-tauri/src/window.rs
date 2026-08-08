//! Native window setup for the STUDIO shell.

/// Ask DWM for rounded corners but suppress its visible frame border, so the
/// frameless window keeps a quiet, Mac-style silhouette. The CSS panel radius
/// (`SHELL.frameRadius`) is the visible inner shape. Same contract as the
/// previous STUDIO shell.
#[cfg(target_os = "windows")]
pub fn apply_rounded_corners(window: &tauri::WebviewWindow) {
  use windows::Win32::Graphics::Dwm::{
    DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    DWM_WINDOW_CORNER_PREFERENCE, DwmSetWindowAttribute,
  };

  if let Ok(hwnd) = window.hwnd() {
    let corner_preference = DWMWCP_ROUND;
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
pub fn apply_rounded_corners(_window: &tauri::WebviewWindow) {}
