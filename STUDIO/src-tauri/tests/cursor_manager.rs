#![cfg(target_os = "windows")]

use std::{
  io::Write,
  process::{Child, Command, Stdio},
  thread,
  time::{Duration, Instant},
};

fn start_helper() -> Child {
  let mut child = Command::new(env!("CARGO_BIN_EXE_studio"))
    .arg("--studio-cursor-manager")
    .stdin(Stdio::piped())
    .spawn()
    .expect("launch the actual Studio executable in helper mode");
  // The process ID cannot match a desktop window. This exercises lease
  // handling and never changes the interactive desktop's cursor scheme.
  writeln!(child.stdin.as_mut().unwrap(), "1 {}", u32::MAX).unwrap();
  child
}

fn wait_for_exit(child: &mut Child, timeout: Duration) {
  let started = Instant::now();
  while started.elapsed() < timeout {
    if let Some(status) = child.try_wait().unwrap() {
      assert!(status.success());
      return;
    }
    thread::sleep(Duration::from_millis(25));
  }
  let _ = child.kill();
  let _ = child.wait();
  panic!("cursor helper did not exit after {timeout:?}");
}

#[test]
fn executable_releases_the_lease_on_pipe_close_or_host_stall() {
  let mut closing = start_helper();
  closing.stdin.take();
  wait_for_exit(&mut closing, Duration::from_secs(4));

  let mut stalled = start_helper();
  thread::sleep(Duration::from_millis(250));
  assert!(stalled.try_wait().unwrap().is_none());
  wait_for_exit(&mut stalled, Duration::from_secs(5));
}
