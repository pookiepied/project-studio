// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  #[cfg(target_os = "windows")]
  if studio_lib::run_cursor_manager_if_requested() {
    return;
  }
  studio_lib::run();
}
