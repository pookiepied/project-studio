use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// Timeout contract
// ---------------------------------------------------------------------------

/// Maximum time to wait for a JSON-RPC response from any MCP subprocess.
/// This is the hard ceiling at the Rust layer — the deepest protection in the
/// call stack. Studio-harness tools all have their own per-tool ceilings
/// (15s–120s), so this value only fires if the Node.js process itself hangs,
/// crashes silently, or stops writing to stdout. 180 s is generous enough to
/// never interfere with normal operation while still preventing infinite hangs.
const MCP_RESPONSE_TIMEOUT_SECS: u64 = 180;

// ---------------------------------------------------------------------------
// Platform command resolution
// ---------------------------------------------------------------------------

/// On Windows, npm-installed CLI wrappers (npx, npm, etc.) are `.cmd` batch
/// files. Rust's `Command::new()` calls `CreateProcess` directly, which does
/// NOT resolve `.cmd` extensions — only `cmd.exe` does. This helper wraps any
/// non-.exe, non-absolute-path command through `cmd /C` on Windows so that
/// PATH lookup and batch-file resolution work correctly. On macOS/Linux it is
/// a no-op.
///
/// Returns `(resolved_command, resolved_args)` ready for `Command::new`.
fn platform_command(command: &str, args: &[String]) -> (String, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        let path = std::path::Path::new(command);
        let needs_shell = !path.is_absolute()
            && !command.to_ascii_lowercase().ends_with(".exe");
        if needs_shell {
            let mut shell_args = vec!["/C".to_string(), command.to_string()];
            shell_args.extend_from_slice(args);
            return ("cmd".to_string(), shell_args);
        }
    }
    (command.to_string(), args.to_vec())
}

// ---------------------------------------------------------------------------
// Internal process state
// ---------------------------------------------------------------------------

struct McpProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl McpProcess {
    /// Write one JSON-RPC message (adds a newline — MCP uses line-delimited JSON).
    async fn write_msg(&mut self, msg: &Value) -> Result<(), String> {
        let mut line = msg.to_string();
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        self.stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Read lines from stdout until we receive the JSON-RPC response for `id`.
    /// Skips notification messages (no "id" field) and unrelated responses.
    /// Does NOT apply a timeout here — callers wrap this with
    /// `tokio::time::timeout(MCP_RESPONSE_TIMEOUT_SECS, ...)` so the error
    /// message can include the server name and tool name.
    async fn read_response(&mut self, id: u64) -> Result<Value, String> {
        loop {
            let mut line = String::new();
            let n = self
                .stdout
                .read_line(&mut line)
                .await
                .map_err(|e| e.to_string())?;
            if n == 0 {
                return Err("MCP server closed connection unexpectedly".to_string());
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let msg: Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(_) => continue, // skip any non-JSON startup output
            };
            if msg.get("id") == Some(&json!(id)) {
                if let Some(err) = msg.get("error") {
                    return Err(format!("MCP error: {}", err));
                }
                return Ok(msg.get("result").cloned().unwrap_or(Value::Null));
            }
            // Notification or unrelated — skip and keep reading
        }
    }

    /// Execute the MCP initialize handshake (required before any tool calls).
    async fn initialize(&mut self) -> Result<(), String> {
        let id = self.next_id;
        self.next_id += 1;

        self.write_msg(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "STUDIO", "version": "1.0.0" }
            }
        }))
        .await?;

        tokio::time::timeout(
            Duration::from_secs(MCP_RESPONSE_TIMEOUT_SECS),
            self.read_response(id),
        )
        .await
        .map_err(|_| {
            format!(
                "MCP server did not complete initialize handshake within {}s — \
                 server may have crashed on startup",
                MCP_RESPONSE_TIMEOUT_SECS
            )
        })??;

        // Acknowledge with initialized notification (no id — it's a notification)
        self.write_msg(&json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }))
        .await?;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// McpManager — managed state
// ---------------------------------------------------------------------------

pub struct McpManager {
    processes: Arc<Mutex<HashMap<String, McpProcess>>>,
}

impl McpManager {
    pub fn new() -> Self {
        McpManager {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start an MCP server subprocess and perform the initialize handshake.
    pub async fn start(
        &self,
        name: &str,
        command: &str,
        args: &[String],
        env_vars: &HashMap<String, String>,
    ) -> Result<(), String> {
        let mut processes = self.processes.lock().await;

        if processes.contains_key(name) {
            return Ok(()); // already running — idempotent
        }

        let (resolved_cmd, resolved_args) = platform_command(command, args);
        let mut cmd = Command::new(&resolved_cmd);
        cmd.args(&resolved_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()); // piped so we can log errors from the subprocess

        // On Windows, suppress the console window that would otherwise appear
        // when spawning Node.js subprocesses in a production build.
        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        for (k, v) in env_vars {
            cmd.env(k, v);
        }

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to start MCP server '{}' (command: '{}'): {}",
                name, resolved_cmd, e
            )
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or("Failed to capture MCP server stdin")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture MCP server stdout")?;

        // Drain stderr in a background task and log each line — this is the
        // only way to see subprocess crash messages since there is no console.
        if let Some(stderr) = child.stderr.take() {
            let server_name = name.to_string();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => eprintln!("[MCP {}] {}", server_name, line.trim()),
                    }
                }
            });
        }

        let mut process = McpProcess {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
        };

        process.initialize().await.map_err(|e| {
            format!("MCP server '{}' initialize handshake failed: {}", name, e)
        })?;

        processes.insert(name.to_string(), process);
        Ok(())
    }

    /// Stop a running MCP server subprocess.
    pub async fn stop(&self, name: &str) -> Result<(), String> {
        let mut processes = self.processes.lock().await;
        if let Some(mut process) = processes.remove(name) {
            let _ = process.child.kill().await;
        }
        Ok(())
    }

    /// Send a `tools/call` JSON-RPC request and return the result.
    ///
    /// Wraps `read_response` with `MCP_RESPONSE_TIMEOUT_SECS` so that a hung
    /// or crashed server never blocks the Tauri thread indefinitely.
    pub async fn call_tool(
        &self,
        server: &str,
        tool: &str,
        arguments: Value,
    ) -> Result<Value, String> {
        let mut processes = self.processes.lock().await;

        // Detect and evict stale entries left by a crashed process. Without
        // this, writing to a dead stdin pipe returns EPIPE, which bubbles up
        // as a confusing "broken pipe" error instead of "server not running".
        let is_dead = processes
            .get_mut(server)
            .map(|p| matches!(p.child.try_wait(), Ok(Some(_))))
            .unwrap_or(false);
        if is_dead {
            processes.remove(server);
            return Err(format!(
                "MCP server '{}' has exited unexpectedly. Restart it from Settings → Local AI.",
                server
            ));
        }

        let process = processes
            .get_mut(server)
            .ok_or_else(|| format!("MCP server '{}' is not running", server))?;

        let id = process.next_id;
        process.next_id += 1;

        process
            .write_msg(&json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": "tools/call",
                "params": { "name": tool, "arguments": arguments }
            }))
            .await?;

        tokio::time::timeout(
            Duration::from_secs(MCP_RESPONSE_TIMEOUT_SECS),
            process.read_response(id),
        )
        .await
        .map_err(|_| {
            format!(
                "MCP server '{}' did not respond to tool '{}' within {}s. \
                 The server process may have crashed or stalled. \
                 Try restarting the server from Settings.",
                server, tool, MCP_RESPONSE_TIMEOUT_SECS
            )
        })?
    }

    /// Send a `tools/list` JSON-RPC request and return the tool manifest.
    pub async fn get_tools(&self, server: &str) -> Result<Value, String> {
        let mut processes = self.processes.lock().await;
        let is_dead = processes
            .get_mut(server)
            .map(|p| matches!(p.child.try_wait(), Ok(Some(_))))
            .unwrap_or(false);
        if is_dead {
            processes.remove(server);
            return Err(format!("MCP server '{}' has exited unexpectedly.", server));
        }
        let process = processes
            .get_mut(server)
            .ok_or_else(|| format!("MCP server '{}' is not running", server))?;

        let id = process.next_id;
        process.next_id += 1;

        process
            .write_msg(&json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": "tools/list",
                "params": {}
            }))
            .await?;

        tokio::time::timeout(
            Duration::from_secs(MCP_RESPONSE_TIMEOUT_SECS),
            process.read_response(id),
        )
        .await
        .map_err(|_| {
            format!(
                "MCP server '{}' did not respond to tools/list within {}s",
                server, MCP_RESPONSE_TIMEOUT_SECS
            )
        })?
    }

    /// Names of all currently running servers.
    ///
    /// Also prunes any processes that have exited since the last call (e.g. the
    /// user closed the window externally, or the server crashed). Emits a
    /// `mcp-server-status` event for each dead process so the UI updates.
    pub async fn list_running(&self, app: &AppHandle) -> Vec<String> {
        let mut processes = self.processes.lock().await;

        let dead: Vec<String> = processes
            .iter_mut()
            .filter_map(|(name, proc)| {
                // try_wait returns Ok(Some(_)) if the process has already exited
                matches!(proc.child.try_wait(), Ok(Some(_))).then(|| name.clone())
            })
            .collect();

        for name in &dead {
            processes.remove(name);
            let _ = app.emit(
                "mcp-server-status",
                json!({ "name": name, "running": false, "error": "Server process exited unexpectedly" }),
            );
        }

        processes.keys().cloned().collect()
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Start an MCP server subprocess.
///
/// `command`  — executable to run (e.g. "npx", "python", "node")
/// `args`     — command-line arguments
/// `env_vars` — additional environment variables (e.g. API tokens)
#[tauri::command]
pub async fn mcp_start_server(
    name: String,
    command: String,
    args: Vec<String>,
    env_vars: HashMap<String, String>,
    state: tauri::State<'_, McpManager>,
    app: AppHandle,
) -> Result<bool, String> {
    state.start(&name, &command, &args, &env_vars).await?;
    let _ = app.emit(
        "mcp-server-status",
        json!({ "name": name, "running": true, "error": null }),
    );
    println!("[MCP] Started server '{}'", name);
    Ok(true)
}

/// Stop a running MCP server subprocess.
#[tauri::command]
pub async fn mcp_stop_server(
    name: String,
    state: tauri::State<'_, McpManager>,
    app: AppHandle,
) -> Result<bool, String> {
    state.stop(&name).await?;
    let _ = app.emit(
        "mcp-server-status",
        json!({ "name": name, "running": false, "error": null }),
    );
    println!("[MCP] Stopped server '{}'", name);
    Ok(true)
}

/// Execute an MCP tool call on a running server.
/// Returns the raw JSON result from the server.
#[tauri::command]
pub async fn mcp_call_tool(
    server: String,
    tool: String,
    args: Value,
    state: tauri::State<'_, McpManager>,
) -> Result<Value, String> {
    println!("[MCP] Calling tool '{}' on server '{}'", tool, server);
    state.call_tool(&server, &tool, args).await
}

/// Fetch the tool manifest from a running server (useful after start to sync KV).
#[tauri::command]
pub async fn mcp_get_tools(
    server: String,
    state: tauri::State<'_, McpManager>,
) -> Result<Value, String> {
    state.get_tools(&server).await
}

/// Run a one-shot setup command synchronously and return its output.
///
/// Unlike `mcp_start_server` this does NOT attempt a JSON-RPC handshake —
/// it simply spawns the process, waits for it to exit, and returns the
/// combined stdout+stderr. Intended for prerequisite setup steps that must
/// complete before the MCP server subprocess is started.
#[tauri::command]
pub async fn mcp_run_setup(
    command: String,
    args: Vec<String>,
    env_vars: HashMap<String, String>,
) -> Result<String, String> {
    let (resolved_cmd, resolved_args) = platform_command(&command, &args);
    let mut cmd = Command::new(&resolved_cmd);
    cmd.args(&resolved_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    for (k, v) in &env_vars {
        cmd.env(k, v);
    }

    let output = cmd.output().await.map_err(|e| {
        format!("Failed to run setup command '{}': {}", resolved_cmd, e)
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = format!("{}{}", stdout, stderr).trim().to_string();

    if output.status.success() {
        Ok(combined)
    } else {
        Err(format!(
            "Setup command failed (exit {}): {}",
            output.status.code().unwrap_or(-1),
            if combined.is_empty() { "no output".to_string() } else { combined }
        ))
    }
}

/// List names of all currently running MCP servers.
/// Dead processes (crashed or closed externally) are pruned and a
/// `mcp-server-status` event is emitted for each so the UI stays in sync.
#[tauri::command]
pub async fn mcp_list_running(
    state: tauri::State<'_, McpManager>,
    app: AppHandle,
) -> Result<Vec<String>, String> {
    Ok(state.list_running(&app).await)
}

/// Strip the `\\?\` extended-length path prefix that `std::fs::canonicalize`
/// adds on Windows. Node.js cannot load modules from `\\?\`-prefixed paths.
fn strip_unc_prefix(path: std::path::PathBuf) -> String {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        s.into_owned()
    }
}

/// Resolve the path to a local MCP server bundle.
///
/// Studio Harness and Computer Use are now two independent packages, each
/// building a single bundle at `library/mcp-servers/<category>/<server>/dist/index.js`.
/// This helper resolves that
/// path for either of them. Checks the bundled resources directory first
/// (production), then falls back to the dev-build path relative to the executable.
fn resolve_local_mcp_server_path(
    app: &tauri::AppHandle,
    server: &str,
) -> Result<String, String> {
    let category = match server {
        "studio-harness" => "harness",
        "computer-use" => "desktop",
        "mcp-management" | "skill-management" | "skill-execution" => "system",
        _ => return Err(format!("Unknown bundled MCP server: {}", server)),
    };
    let rel = format!("library/mcp-servers/{}/{}/dist/index.js", category, server);

    if let Ok(res_dir) = app.path().resource_dir() {
        let candidate = res_dir.join(&rel);
        if candidate.exists() {
            return Ok(strip_unc_prefix(candidate));
        }
    }

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe.parent().ok_or("Cannot determine executable directory")?;
    let workspace = exe_dir.join("../../..").join(&rel);

    let canonical = std::fs::canonicalize(&workspace).map_err(|e| {
        format!(
            "{} MCP server not found at '{:?}': {}. \
             Run `npm run build` inside library/mcp-servers/{} first.",
            server, workspace, e, server
        )
    })?;

    Ok(strip_unc_prefix(canonical))
}

#[tauri::command]
pub fn mcp_resolve_studio_harness_server_path(app: tauri::AppHandle) -> Result<String, String> {
    resolve_local_mcp_server_path(&app, "studio-harness")
}

#[tauri::command]
pub fn mcp_resolve_computer_use_server_path(app: tauri::AppHandle) -> Result<String, String> {
    resolve_local_mcp_server_path(&app, "computer-use")
}

#[tauri::command]
pub fn mcp_resolve_bundled_server_path(app: tauri::AppHandle, server: String) -> Result<String, String> {
    resolve_local_mcp_server_path(&app, &server)
}

#[tauri::command] pub fn mcp_resolve_mcp_management_server_path(app: tauri::AppHandle) -> Result<String,String> { resolve_local_mcp_server_path(&app,"mcp-management") }
#[tauri::command] pub fn mcp_resolve_skill_management_server_path(app: tauri::AppHandle) -> Result<String,String> { resolve_local_mcp_server_path(&app,"skill-management") }
#[tauri::command] pub fn mcp_resolve_skill_execution_server_path(app: tauri::AppHandle) -> Result<String,String> { resolve_local_mcp_server_path(&app,"skill-execution") }
