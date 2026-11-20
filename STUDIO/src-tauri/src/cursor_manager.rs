//! Owns the temporary Windows cursor override in a process outside the Harness job.

use crate::{indicator_target_is_foreground, IndicatorTarget as Target};
use std::{
  io::{self, BufRead, Write},
  os::windows::{
    io::{AsRawHandle, FromRawHandle, OwnedHandle},
    process::CommandExt,
  },
  process::{Child, Command, Stdio},
  sync::mpsc,
  time::{Duration, Instant},
};
use windows::{
  core::{w, BOOL, PCWSTR},
  Win32::{
    Foundation::{HANDLE, HWND, POINT, RECT, WAIT_ABANDONED, WAIT_OBJECT_0},
    System::Threading::{CreateMutexW, ReleaseMutex, WaitForSingleObject},
    UI::{
      HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
      Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON},
      WindowsAndMessaging::{
        CopyIcon, CreateIconFromResourceEx, DestroyCursor, GetAncestor, GetCursorPos, GetForegroundWindow,
        GetSystemMetrics, GetWindowRect, GetWindowThreadProcessId, LoadCursorW, SetSystemCursor,
        SystemParametersInfoW, GA_ROOT, HCURSOR, HICON, IDC_ARROW, IDC_HAND, IDC_IBEAM, LR_DEFAULTCOLOR,
        OCR_HAND, OCR_IBEAM, OCR_NORMAL, SM_CXCURSOR, SPI_GETCLIENTAREAANIMATION, SPI_SETCURSORS,
        SYSTEM_CURSOR_ID, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
      },
    },
  },
};

pub const ARG: &str = "--studio-cursor-manager";
const HEARTBEAT: Duration = Duration::from_millis(400);
const EXPIRES: Duration = Duration::from_millis(1400);
const TICK: Duration = Duration::from_millis(32);
const ART: &[u8] = include_bytes!("../icons/studio-pointer.rt-cursor");
const SLOTS: [(SYSTEM_CURSOR_ID, PCWSTR); 3] = [
  (OCR_NORMAL, IDC_ARROW),
  (OCR_HAND, IDC_HAND),
  (OCR_IBEAM, IDC_IBEAM),
];

/// Closing the pipe lets the helper restore after the host or Harness exits.
#[derive(Default)]
pub struct CursorManager {
  child: Option<Child>,
  lock: Option<SessionMutex>,
  last_sent: Option<(Target, Instant)>,
  started: Option<Instant>,
}

impl CursorManager {
  pub fn update(&mut self, target: Option<Target>) {
    if self
      .child
      .as_mut()
      .is_some_and(|child| !matches!(child.try_wait(), Ok(None)))
    {
      self.child = None;
      self.last_sent = None;
      // Keep a handle open while the helper runs so Windows can report an
      // abandoned override if the helper is forcibly terminated.
      if let Some(lock) = &self.lock {
        let _ = lock.acquire();
      }
    }
    let Some(target) = target else {
      if let Some(child) = self.child.as_mut() {
        child.stdin.take();
      }
      self.last_sent = None;
      return;
    };
    if self.child.is_none() {
      if self
        .started
        .is_some_and(|at| at.elapsed() < Duration::from_secs(1))
      {
        return;
      }
      self.started = Some(Instant::now());
      if self.lock.is_none() {
        self.lock = SessionMutex::open();
      }
      if self.lock.is_none() {
        return;
      }
      let Ok(exe) = std::env::current_exe() else {
        return;
      };
      self.child = Command::new(exe)
        .arg(ARG)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .spawn()
        .ok();
    }
    if self
      .last_sent
      .is_some_and(|(last, at)| last == target && at.elapsed() < HEARTBEAT)
    {
      return;
    }
    if let Some(child) = self.child.as_mut() {
      if let Some(pipe) = child.stdin.as_mut() {
        if writeln!(pipe, "{} {}", target.handle, target.pid).is_ok() {
          self.last_sent = Some((target, Instant::now()));
        } else {
          child.stdin.take();
        }
      }
    }
  }
}

fn parse_target(line: &str) -> Option<Target> {
  let mut parts = line.split_whitespace();
  let handle: usize = parts.next()?.parse().ok()?;
  let pid: u32 = parts.next()?.parse().ok()?;
  (handle != 0 && pid != 0 && parts.next().is_none()).then_some(Target { handle, pid })
}

fn target_active(target: Target) -> bool {
  let hwnd = HWND(target.handle as *mut _);
  let mut pid = 0;
  let mut rect = RECT::default();
  let mut pointer = POINT::default();
  unsafe {
    let foreground = GetForegroundWindow();
    GetWindowThreadProcessId(hwnd, Some(&mut pid)) != 0
      && indicator_target_is_foreground(
        target,
        foreground.0 as usize,
        GetAncestor(foreground, GA_ROOT).0 as usize,
        pid,
      )
      && GetWindowRect(hwnd, &mut rect).is_ok()
      && GetCursorPos(&mut pointer).is_ok()
      && (rect.left..rect.right).contains(&pointer.x)
      && (rect.top..rect.bottom).contains(&pointer.y)
  }
}

struct SessionMutex(OwnedHandle);

impl SessionMutex {
  fn open() -> Option<Self> {
    let handle = unsafe { CreateMutexW(None, false, w!(r"Local\ProjectStudioComputerCursor")) }.ok()?;
    Some(Self(unsafe { OwnedHandle::from_raw_handle(handle.0) }))
  }

  fn acquire(&self) -> Option<SessionLock<'_>> {
    match unsafe { WaitForSingleObject(self.handle(), 0) } {
      WAIT_OBJECT_0 => Some(SessionLock(self)),
      WAIT_ABANDONED => {
        restore_scheme();
        Some(SessionLock(self))
      }
      _ => None,
    }
  }

  fn handle(&self) -> HANDLE {
    HANDLE(self.0.as_raw_handle())
  }
}

struct SessionLock<'a>(&'a SessionMutex);

impl Drop for SessionLock<'_> {
  fn drop(&mut self) {
    let _ = unsafe { ReleaseMutex(self.0.handle()) };
  }
}

fn restore_scheme() {
  let _ = unsafe { SystemParametersInfoW(SPI_SETCURSORS, 0, None, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)) };
}

struct SavedCursor(SYSTEM_CURSOR_ID, Option<HCURSOR>);

impl Drop for SavedCursor {
  fn drop(&mut self) {
    if let Some(cursor) = self.1.take() {
      let _ = unsafe { DestroyCursor(cursor) };
    }
  }
}

/// Save all original cursor handles first. A partial installation is rolled
/// back by this guard the same way as a completed one.
struct CursorSlots {
  saved: Vec<SavedCursor>,
  changed: bool,
}

fn make_cursor(size: i32) -> windows::core::Result<HCURSOR> {
  // RT_CURSOR resource data must be aligned on a DWORD boundary.
  let mut aligned = [0u32; ART.len().div_ceil(4)];
  let bytes = unsafe { std::slice::from_raw_parts_mut(aligned.as_mut_ptr().cast::<u8>(), ART.len()) };
  bytes.copy_from_slice(ART);
  unsafe { CreateIconFromResourceEx(bytes, false, 0x0003_0000, size, size, LR_DEFAULTCOLOR) }
    .map(|icon| HCURSOR(icon.0))
}

impl CursorSlots {
  fn capture() -> windows::core::Result<Self> {
    let mut saved = Vec::with_capacity(SLOTS.len());
    for (slot, id) in SLOTS {
      let cursor = unsafe { LoadCursorW(None, id)? };
      let original = unsafe { CopyIcon(HICON(cursor.0))? };
      saved.push(SavedCursor(slot, Some(HCURSOR(original.0))));
    }
    Ok(Self {
      saved,
      changed: false,
    })
  }

  fn apply(&mut self, size: i32) -> windows::core::Result<()> {
    for (slot, _) in SLOTS {
      let cursor = make_cursor(size)?;
      self.changed = true;
      // SetSystemCursor consumes this handle. Keep only the original copies.
      unsafe { SetSystemCursor(cursor, slot)? };
    }
    Ok(())
  }
}

impl Drop for CursorSlots {
  fn drop(&mut self) {
    if !self.changed {
      return;
    }
    let mut failed = false;
    for saved in &mut self.saved {
      if let Some(original) = saved.1.take() {
        failed |= unsafe { SetSystemCursor(original, saved.0) }.is_err();
      }
    }
    if failed {
      restore_scheme();
    }
  }
}

fn animations_enabled() -> bool {
  let mut enabled = BOOL(0);
  unsafe {
    SystemParametersInfoW(
      SPI_GETCLIENTAREAANIMATION,
      0,
      Some((&mut enabled as *mut BOOL).cast()),
      SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
    )
    .is_ok()
      && enabled.as_bool()
  }
}

fn mouse_down() -> bool {
  [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON]
    .iter()
    .any(|key| unsafe { GetAsyncKeyState(i32::from(key.0)) } < 0)
}

/// Managed by the main executable, never by the driver or a model tool.
pub fn run_guard() {
  let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
  let Some(mutex) = SessionMutex::open() else {
    return;
  };
  let (send, receive) = mpsc::sync_channel(1);
  std::thread::spawn(move || {
    for line in io::stdin().lock().lines().map_while(Result::ok) {
      let Some(target) = parse_target(&line) else {
        break;
      };
      if send.send((target, Instant::now())).is_err() {
        break;
      }
    }
  });

  let normal_size = unsafe { GetSystemMetrics(SM_CXCURSOR) }.clamp(32, 256);
  let animate = animations_enabled();
  let mut current = None;
  // Tuple fields drop in order, restoring the cursors while the lock is held.
  let mut slots = None;
  let mut size = 0;
  let mut pressed = false;
  let mut rebound = None;
  loop {
    match receive.recv_timeout(TICK) {
      Ok(target) => current = Some(target),
      Err(mpsc::RecvTimeoutError::Disconnected) => break,
      Err(mpsc::RecvTimeoutError::Timeout) => {}
    }
    let Some((target, updated)) = current else {
      // A launcher that never sends a lease cannot keep an idle helper alive.
      if let Ok(next) = receive.recv_timeout(EXPIRES) {
        current = Some(next);
        continue;
      }
      break;
    };
    if updated.elapsed() >= EXPIRES {
      break;
    }
    if !target_active(target) {
      slots = None;
      size = 0;
      pressed = false;
      rebound = None;
      continue;
    }
    let down = animate && mouse_down();
    if pressed && !down {
      rebound = Some(Instant::now());
    }
    pressed = down;
    let desired = if down {
      normal_size * 83 / 100
    } else if rebound.is_some_and(|at| at.elapsed() < Duration::from_millis(64)) {
      normal_size * 107 / 100
    } else {
      normal_size
    };
    if size == desired {
      continue;
    }
    if slots.is_none() {
      let Some(lock) = mutex.acquire() else {
        continue;
      };
      let Ok(saved) = CursorSlots::capture() else {
        break;
      };
      slots = Some((saved, lock));
    }
    let Some((active, _)) = slots.as_mut() else {
      break;
    };
    if active.apply(desired).is_err() {
      break;
    }
    size = desired;
  }
  // Drop restores the cursor before releasing the session lock.
  drop(slots);
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn rejects_invalid_lease_messages() {
    assert_eq!(
      parse_target("1234 20"),
      Some(Target {
        handle: 1234,
        pid: 20
      })
    );
    for line in ["", "0 1", "2 0", "-3 1", "2 3 extra"] {
      assert_eq!(parse_target(line), None);
    }
  }

  #[test]
  fn creates_normal_and_pressed_cursor_resources_without_installing_them() {
    for size in [26, 32, 34] {
      let cursor = make_cursor(size).expect("valid Windows cursor resource");
      assert!(!cursor.0.is_null());
      unsafe { DestroyCursor(cursor) }.unwrap();
    }
  }

  #[test]
  fn captures_the_existing_cursor_slots_without_replacing_them() {
    let saved = CursorSlots::capture().expect("the desktop exposes the three common cursors");
    assert_eq!(saved.saved.len(), SLOTS.len());
    assert!(!saved.changed);
  }
}
