/// PTY backend — gives the frontend a real pseudo-terminal backed by the OS.
///
/// Each "session" is one shell process (PowerShell on Windows, bash elsewhere)
/// running inside a ConPTY/winpty (Windows) or posix-pty (macOS/Linux).
/// The shell sees a proper TTY, so interactive programs like `claude`, `python`,
/// `vim`, `git log --graph`, etc. all work correctly.
///
/// Tauri commands exposed:
///   pty_create(sessionId, cols, rows, cwd?, env?, program?, args?) → spawns
///     shell (or `program` directly when given), starts streaming
///   pty_write(sessionId, data)               → stdin to shell (keypresses / paste)
///   pty_resize(sessionId, cols, rows)        → resize terminal window
///   pty_close(sessionId)                     → kill shell, free resources
///
/// Tauri events emitted:
///   "pty-data"   { sessionId, data: String }  — shell stdout/stderr
///   "pty-exit"   { sessionId }                — shell process exited
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
};
use tauri::Emitter;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
pub struct PtyDataEvent {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub data: String,
}

#[derive(serde::Serialize, Clone)]
pub struct PtyExitEvent {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

/// One live PTY session.
pub struct PtySession {
    pub request_tx: std::sync::mpsc::SyncSender<PtyRequest>,
}

pub enum PtyRequest {
    Write(Vec<u8>),
    Resize(PtySize),
}

pub type PtyStore = Arc<Mutex<HashMap<String, PtySession>>>;

pub fn new_store() -> PtyStore {
    Arc::new(Mutex::new(HashMap::new()))
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Spawn a real PTY-backed shell and begin streaming its output.
///
/// `program`/`args` (optional): when set, the PTY launches that program
/// directly (e.g. `claude`, `codex`, `opencode`) instead of an interactive
/// shell. On Windows it is run through `powershell -NoLogo -Command <prog>`
/// so npm-style `.cmd` shims resolve and the command isn't echoed as typed
/// input — the program owns the terminal from the first frame.
#[tauri::command]
pub fn pty_create(
    session_id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: Option<std::collections::HashMap<String, String>>,
    program: Option<String>,
    args: Option<Vec<String>>,
    app_handle: tauri::AppHandle,
    store: tauri::State<'_, PtyStore>,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::sync_channel::<PtyRequest>(128);

    // Register BEFORE spawning so the first pty_write never races.
    {
        let mut s = store.lock().unwrap();
        s.insert(session_id.clone(), PtySession { request_tx: tx });
    }

    let sid = session_id.clone();

    std::thread::spawn(move || {
        // ── Open PTY ──
        let pty_system = native_pty_system();
        let pair = match pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(p) => p,
            Err(e) => {
                let _ = app_handle.emit(
                    "pty-data",
                    PtyDataEvent {
                        session_id: sid.clone(),
                        data: format!("\r\n\x1b[31mFailed to open PTY: {e}\x1b[0m\r\n"),
                    },
                );
                return;
            }
        };

        // ── Build the command to spawn ──
        // If `program` is provided, launch it directly (via PowerShell -Command
        // on Windows so .cmd shims resolve and the invocation isn't echoed).
        // Otherwise fall back to the default interactive shell.
        #[cfg(target_os = "windows")]
        let shell_cmd = {
            let mut c = match &program {
                Some(prog) => {
                    let mut c = CommandBuilder::new("powershell");
                    c.args(["-NoLogo", "-NoProfile", "-Command"]);
                    let mut line = prog.clone();
                    if let Some(ref a) = args {
                        for arg in a.iter() {
                            line.push(' ');
                            line.push_str(arg);
                        }
                    }
                    c.arg(line);
                    c
                }
                None => {
                    let mut c = CommandBuilder::new("powershell");
                    c.args(["-NoLogo"]);
                    c
                }
            };
            if let Some(ref dir) = cwd {
                c.cwd(dir);
            }
            if let Some(ref vars) = env {
                for (k, v) in vars {
                    c.env(k, v);
                }
            }
            c
        };
        #[cfg(not(target_os = "windows"))]
        let shell_cmd = {
            let mut c = match &program {
                Some(prog) => {
                    let mut c = CommandBuilder::new(prog);
                    if let Some(ref a) = args {
                        for arg in a.iter() {
                            c.arg(arg);
                        }
                    }
                    c
                }
                None => {
                    let mut c = CommandBuilder::new("bash");
                    c.arg("-l");
                    c
                }
            };
            if let Some(ref dir) = cwd {
                c.cwd(dir);
            }
            if let Some(ref vars) = env {
                for (k, v) in vars {
                    c.env(k, v);
                }
            }
            c
        };

        let mut child = match pair.slave.spawn_command(shell_cmd) {
            Ok(c) => c,
            Err(e) => {
                let _ = app_handle.emit(
                    "pty-data",
                    PtyDataEvent {
                        session_id: sid.clone(),
                        data: format!("\r\n\x1b[31mFailed to spawn shell: {e}\x1b[0m\r\n"),
                    },
                );
                return;
            }
        };

        // Slave is no longer needed after spawning.
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().expect("clone reader");
        let mut writer = pair.master.take_writer().expect("take writer");

        // ── Reader thread: PTY output → frontend ──
        let app_read = app_handle.clone();
        let sid_read = sid.clone();
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                        let _ = app_read.emit(
                            "pty-data",
                            PtyDataEvent {
                                session_id: sid_read.clone(),
                                data,
                            },
                        );
                    }
                }
            }
        });

        // ── Writer loop: receive key data from frontend, write to PTY stdin ──
        for request in rx {
            match request {
                PtyRequest::Write(bytes) => {
                    if writer.write_all(&bytes).is_err() {
                        break;
                    }
                }
                PtyRequest::Resize(size) => {
                    let _ = pair.master.resize(size);
                }
            }
        }

        // Channel dropped (pty_close called) — let child exit naturally.
        drop(writer);
        let _ = child.wait();

        let _ = app_handle.emit("pty-exit", PtyExitEvent { session_id: sid });
    });

    Ok(())
}

/// Forward raw bytes (key presses, paste) to the shell's stdin.
#[tauri::command]
pub fn pty_write(
    session_id: String,
    data: String,
    store: tauri::State<'_, PtyStore>,
) -> Result<(), String> {
    let s = store.lock().unwrap();
    match s.get(&session_id) {
        Some(sess) => sess
            .request_tx
            .send(PtyRequest::Write(data.into_bytes()))
            .map_err(|e| e.to_string()),
        None => Err(format!("PTY session not found: {session_id}")),
    }
}

#[tauri::command]
pub fn pty_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    store: tauri::State<'_, PtyStore>,
) -> Result<(), String> {
    let s = store.lock().unwrap();
    match s.get(&session_id) {
        Some(sess) => sess
            .request_tx
            .send(PtyRequest::Resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            }))
            .map_err(|e| e.to_string()),
        None => Err(format!("PTY session not found: {session_id}")),
    }
}

/// Close the PTY session (drop the sender → stdin EOF → shell exits).
#[tauri::command]
pub fn pty_close(session_id: String, store: tauri::State<'_, PtyStore>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.remove(&session_id);
    Ok(())
}
