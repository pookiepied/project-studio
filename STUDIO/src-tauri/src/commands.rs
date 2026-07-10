use std::process::{Command, Stdio};
use std::fs;
use std::path::Path;
use std::collections::HashMap;
use uuid::Uuid;
use tokio::process::Command as TokioCommand;
use tokio::io::{BufReader, AsyncBufReadExt};
use tauri::Emitter;
use std::sync::{LazyLock, Mutex};

pub mod git;
pub use git::{git_checkout_branch, git_create_branch, git_list_branches};

// Store current CSP configuration
static CURRENT_CSP: Mutex<Option<String>> = Mutex::new(None);
static CLAUDE_BRIDGE_PROCESSES: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Application name used as the keyring service identifier.
const KEYRING_SERVICE: &str = "com.pookiepied.studio";

#[derive(serde::Serialize, Clone)]
pub struct ClaudeBridgeOutputEvent {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub text: String,
    pub stream: String,
}

#[derive(serde::Serialize, Clone)]
pub struct ClaudeBridgeExitEvent {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub code: i32,
}

#[derive(serde::Serialize, Clone)]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    #[serde(rename = "isFile")]
    pub is_file: bool,
    pub size: u64,
    #[serde(rename = "modifiedMs")]
    pub modified_ms: Option<u128>,
}

#[tauri::command]
pub async fn execute_shell_command(command: String, args: Vec<String>) -> Result<String, String> {
    println!("[Shell] Executing: {} {:?}", command, args);

    let output = Command::new(&command)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute command '{}': {}", command, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Command failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.to_string())
}

#[tauri::command]
pub async fn claude_bridge_start(
    session_id: String,
    prompt: String,
    cwd: Option<String>,
    resume: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    thinking_budget: Option<u32>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut cmd = TokioCommand::new("claude");
    cmd.arg("-p");
    cmd.arg("--verbose");
    cmd.args(["--output-format", "stream-json"]);
    cmd.arg("--include-partial-messages");

    // Effort → extended-thinking budget. Claude Code reads MAX_THINKING_TOKENS
    // from the environment to size its thinking; 0 (or absence) leaves it off.
    if let Some(budget) = thinking_budget {
        if budget > 0 {
            cmd.env("MAX_THINKING_TOKENS", budget.to_string());
        }
    }

    if let Some(ref resume_id) = resume {
        if !resume_id.trim().is_empty() {
            cmd.args(["--resume", resume_id.trim()]);
        }
    } else if let Some(ref selected_model) = model {
        if !selected_model.trim().is_empty() {
            cmd.args(["--model", selected_model.trim()]);
        }
    }

    if let Some(ref mode) = permission_mode {
        if !mode.trim().is_empty() {
            cmd.args(["--permission-mode", mode.trim()]);
        }
    }

    cmd.arg(prompt);

    if let Some(ref dir) = cwd {
        let p = Path::new(dir);
        if p.exists() {
            cmd.current_dir(p);
        }
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Claude bridge: {}", e))?;

    if let Some(pid) = child.id() {
        let mut processes = CLAUDE_BRIDGE_PROCESSES.lock().unwrap();
        processes.insert(session_id.clone(), pid);
    }

    let stdout = child.stdout.take().ok_or_else(|| "Claude stdout unavailable".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "Claude stderr unavailable".to_string())?;

    let stdout_app = app_handle.clone();
    let stderr_app = app_handle.clone();
    let stdout_session = session_id.clone();
    let stderr_session = session_id.clone();

    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = stdout_app.emit(
                "claude-bridge-output",
                ClaudeBridgeOutputEvent {
                    session_id: stdout_session.clone(),
                    text: line,
                    stream: "stdout".into(),
                },
            );
        }
    });

    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = stderr_app.emit(
                "claude-bridge-output",
                ClaudeBridgeOutputEvent {
                    session_id: stderr_session.clone(),
                    text: line,
                    stream: "stderr".into(),
                },
            );
        }
    });

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed while waiting for Claude bridge: {}", e))?;

    let _ = tokio::join!(stdout_task, stderr_task);

    {
        let mut processes = CLAUDE_BRIDGE_PROCESSES.lock().unwrap();
        processes.remove(&session_id);
    }

    let _ = app_handle.emit(
        "claude-bridge-exit",
        ClaudeBridgeExitEvent {
            session_id,
            code: status.code().unwrap_or(-1),
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn claude_bridge_stop(session_id: String) -> Result<(), String> {
    let pid = {
        let mut processes = CLAUDE_BRIDGE_PROCESSES.lock().unwrap();
        processes.remove(&session_id)
    };

    let Some(pid) = pid else {
        return Ok(());
    };

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|e| format!("Failed to stop Claude bridge: {}", e))?;
        if !status.success() {
            return Err(format!("taskkill exited with status {:?}", status.code()));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let status = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|e| format!("Failed to stop Claude bridge: {}", e))?;
        if !status.success() {
            return Err(format!("kill exited with status {:?}", status.code()));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn execute_pip_with_progress(
    python_path: String,
    args: Vec<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    println!("[Pip] Executing: {} -m pip {:?}", python_path, args);
    
    let mut cmd = TokioCommand::new(&python_path);
    cmd.args(&["-m", "pip"]);
    cmd.args(&args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    
    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn pip command: {}", e))?;
    
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    
    // Read stdout in real-time
    let stdout_reader = BufReader::new(stdout);
    let stderr_reader = BufReader::new(stderr);
    
    let app_handle_clone = app_handle.clone();
    
    // Handle stdout
    let stdout_task = tokio::spawn(async move {
        let mut lines = stdout_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            println!("[Pip Output] {}", line);
            // Emit progress events to frontend
            let _ = app_handle_clone.emit("pip-progress", &line);
        }
    });
    
    // Handle stderr (pip progress usually goes to stderr)
    let stderr_task = tokio::spawn(async move {
        let mut lines = stderr_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            println!("[Pip Progress] {}", line);
            // Emit progress events to frontend
            let _ = app_handle.emit("pip-progress", &line);
        }
    });
    
    // Wait for completion
    let status = child.wait().await
        .map_err(|e| format!("Failed to wait for pip command: {}", e))?;
    
    // Wait for output tasks to complete
    let _ = tokio::join!(stdout_task, stderr_task);
    
    if !status.success() {
        return Err("Pip command failed".to_string());
    }
    
    Ok("Pip command completed successfully".to_string())
}

#[tauri::command]
pub async fn save_audio_to_temp(audio_data: Vec<u8>, extension: String) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    
    let filename = format!("studio_audio_{}.{}", Uuid::new_v4(), extension);
    let temp_path = temp_dir.join(filename);
    
    fs::write(&temp_path, audio_data)
        .map_err(|e| format!("Failed to write audio file: {}", e))?;
    
    println!("[Audio] Saved audio to: {:?}", temp_path);
    
    temp_path.to_str()
        .ok_or_else(|| "Failed to convert path to string".to_string())
        .map(|s| s.to_string())
}

#[tauri::command]
pub async fn get_directory_size(path: String) -> Result<u64, String> {
    let path = Path::new(&path);
    
    if !path.exists() {
        return Ok(0);
    }
    
    calculate_dir_size(path)
        .map_err(|e| format!("Failed to calculate directory size: {}", e))
}

fn calculate_dir_size(dir: &Path) -> Result<u64, std::io::Error> {
    let mut size = 0;
    
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                size += calculate_dir_size(&path)?;
            } else {
                size += entry.metadata()?.len();
            }
        }
    } else {
        size = fs::metadata(dir)?.len();
    }
    
    Ok(size)
}

#[tauri::command]
pub fn get_platform_os() -> String {
    if cfg!(target_os = "windows") {
        "windows".to_string()
    } else if cfg!(target_os = "macos") {
        "macos".to_string()
    } else if cfg!(target_os = "linux") {
        "linux".to_string()
    } else {
        "unknown".to_string()
    }
}

#[tauri::command]
pub fn get_platform_arch() -> String {
    if cfg!(target_arch = "x86_64") {
        "x64".to_string()
    } else if cfg!(target_arch = "aarch64") {
        "arm64".to_string()
    } else if cfg!(target_arch = "x86") {
        "x86".to_string()
    } else {
        "unknown".to_string()
    }
}

// File system operations
#[tauri::command]
pub async fn file_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file '{}': {}", path, e))
}

#[tauri::command]
pub async fn list_directory_entries(path: String) -> Result<Vec<DirectoryEntry>, String> {
    let mut entries = Vec::new();
    let dir = Path::new(&path);
    if !dir.exists() {
        return Ok(entries);
    }

    for entry in fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory '{}': {}", path, e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read directory entry metadata: {}", e))?;
        let path_buf = entry.path();
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis());

        entries.push(DirectoryEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path_buf.to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            is_file: metadata.is_file(),
            size: metadata.len(),
            modified_ms,
        });
    }

    Ok(entries)
}

#[tauri::command]
pub async fn get_home_dir() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn get_studio_home_dir() -> Result<String, String> {
    if let Ok(path) = std::env::var("STUDIO_HOME") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    #[cfg(target_os = "windows")]
    {
        let app_data = std::env::var("APPDATA").map_err(|e| e.to_string())?;
        return Ok(Path::new(&app_data).join("Studio").to_string_lossy().to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        return Ok(Path::new(&home)
            .join("Library")
            .join("Application Support")
            .join("Studio")
            .to_string_lossy()
            .to_string());
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        if let Ok(xdg_data_home) = std::env::var("XDG_DATA_HOME") {
            let trimmed = xdg_data_home.trim();
            if !trimmed.is_empty() {
                return Ok(Path::new(trimmed).join("studio").to_string_lossy().to_string());
            }
        }

        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        Ok(Path::new(&home).join(".local").join("share").join("studio").to_string_lossy().to_string())
    }
}

#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }
    
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write file '{}': {}", path, e))
}

#[tauri::command]
pub async fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create directory '{}': {}", path, e))
}

#[tauri::command]
pub async fn delete_directory(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(()); // already gone — treat as success
    }
    fs::remove_dir_all(&path)
        .map_err(|e| format!("Failed to delete directory '{}': {}", path, e))
}


// OAuth local server for receiving callback
mod oauth_server;

#[tauri::command]
pub async fn start_oauth_server(state: String) -> Result<String, String> {
    println!("[OAuth] Starting OAuth server...");
    
    // Run in blocking task since it's synchronous I/O
    let result = tokio::task::spawn_blocking(move || {
        oauth_server::start_server(state)
    }).await;
    
    match result {
        Ok(r) => r,
        Err(e) => Err(format!("Server task failed: {}", e))
    }
}

// CSP Management Commands

#[tauri::command]
pub async fn update_csp_for_domain(domain: String) -> Result<(), String> {
    println!("[CSP] Updating CSP to allow domain: {}", domain);
    
    // Generate new CSP that includes the custom domain
    let base_csp = "default-src 'self'; connect-src 'self' https://api.pookiepied.dev https://auth.pookiepied.dev https://accounts.google.com https://oauth2.googleapis.com http://localhost:11434 http://127.0.0.1:11434 http://localhost:10110 http://127.0.0.1:10110 http://ipc.localhost ipc: https://tauri.localhost tauri:";
    let new_csp = format!("{} {}; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; media-src 'self' blob:; frame-src https://accounts.google.com;", base_csp, domain);
    
    // Store the new CSP
    {
        let mut current_csp = CURRENT_CSP.lock().unwrap();
        *current_csp = Some(new_csp.clone());
    }
    
    println!("[CSP] Updated CSP: {}", new_csp);
    
    // Note: In a full implementation, you would need to update the webview's CSP
    // This is a simplified version that just stores the CSP for reference
    // The actual CSP update would require webview manipulation
    
    Ok(())
}

#[tauri::command]
pub async fn reset_csp_to_default() -> Result<(), String> {
    println!("[CSP] Resetting CSP to default");
    
    let default_csp = "default-src 'self'; connect-src 'self' https://api.pookiepied.dev https://auth.pookiepied.dev https://accounts.google.com https://oauth2.googleapis.com http://localhost:11434 http://127.0.0.1:11434 http://localhost:10110 http://127.0.0.1:10110 http://ipc.localhost ipc: https://tauri.localhost tauri:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; media-src 'self' blob:; frame-src https://accounts.google.com;";
    
    {
        let mut current_csp = CURRENT_CSP.lock().unwrap();
        *current_csp = Some(default_csp.to_string());
    }
    
    Ok(())
}

#[tauri::command]
pub async fn get_current_csp() -> Result<String, String> {
    let current_csp = CURRENT_CSP.lock().unwrap();
    match &*current_csp {
        Some(csp) => Ok(csp.clone()),
        None => Ok("default-src 'self'; connect-src 'self' https://api.pookiepied.dev https://auth.pookiepied.dev https://accounts.google.com https://oauth2.googleapis.com http://localhost:11434 http://127.0.0.1:11434 http://localhost:10110 http://127.0.0.1:10110 http://ipc.localhost ipc: https://tauri.localhost tauri:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; media-src 'self' blob:; frame-src https://accounts.google.com;".to_string())
    }
}

// ------------------------------------------------------------------
// Secure Storage Commands
//
// Backed by the OS keystore: Windows Credential Manager (DPAPI-encrypted),
// macOS Keychain, or Linux Secret Service. Values are stored as individual
// named credentials under the "com.pookiepied.studio" service.
// ------------------------------------------------------------------

/// No-op kept for frontend API compatibility — the OS keystore needs no init.
pub fn init_secure_storage_sync() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn init_secure_storage() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn store_secure(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key)
        .map_err(|e| format!("Keyring error: {e}"))?;
    entry.set_password(&value)
        .map_err(|e| format!("Failed to store '{key}': {e}"))
}

#[tauri::command]
pub async fn get_secure(key: String) -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key)
        .map_err(|e| format!("Keyring error: {e}"))?;
    entry.get_password()
        .map_err(|_| format!("Key '{key}' not found in secure storage"))
}

#[tauri::command]
pub async fn remove_secure(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key)
        .map_err(|e| format!("Keyring error: {e}"))?;
    // Ignore "not found" — deleting a missing key is not an error.
    match entry.delete_password() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to remove '{key}': {e}")),
    }
}

/// Start the Local Provider Daemon (Ollama / LM Studio bridge).
#[tauri::command]
pub async fn local_provider_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::daemon::DaemonHandle>,
    port: Option<u16>,
    ollama_base_url: Option<String>,
    lm_studio_base_url: Option<String>,
) -> Result<(), String> {
    state.start(
        app,
        crate::daemon::DaemonStartConfig {
            port,
            ollama_base_url,
            lm_studio_base_url,
        },
    )
}

/// Stop the Local Provider Daemon.
#[tauri::command]
pub fn local_provider_stop(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::daemon::DaemonHandle>,
) {
    state.stop(app);
}

/// Returns true if the Local Provider Daemon is currently running.
#[tauri::command]
pub fn local_provider_is_running(state: tauri::State<'_, crate::daemon::DaemonHandle>) -> bool {
    state.is_running()
}

/// Returns the port the Local Provider Daemon listens on.
#[tauri::command]
pub fn local_provider_port(state: tauri::State<'_, crate::daemon::DaemonHandle>) -> u16 {
    state.port()
}

/// Find the Chrome executable path on the current platform.
fn find_chrome_path() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        // Check registry first (most reliable on Windows)
        let reg_paths = [
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
        ];
        for key in &reg_paths {
            if let Ok(output) = Command::new("reg")
                .args(["query", &format!("HKLM\\{}", key), "/ve"])
                .output()
            {
                let out = String::from_utf8_lossy(&output.stdout);
                for line in out.lines() {
                    if line.contains("REG_SZ") {
                        let parts: Vec<&str> = line.splitn(4, ' ').collect();
                        if let Some(p) = parts.last() {
                            let p = p.trim();
                            if Path::new(p).exists() {
                                return Some(p.to_string());
                            }
                        }
                    }
                }
            }
        }
        // Fallback: common install paths
        let candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ];
        for c in &candidates {
            if Path::new(c).exists() {
                return Some(c.to_string());
            }
        }
        // Check %LOCALAPPDATA%
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let p = format!(r"{}\Google\Chrome\Application\chrome.exe", local);
            if Path::new(&p).exists() {
                return Some(p);
            }
        }
        None
    }
    #[cfg(target_os = "macos")]
    {
        let candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ];
        for c in &candidates {
            if Path::new(c).exists() {
                return Some(c.to_string());
            }
        }
        None
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        for bin in &["google-chrome", "chromium-browser", "chromium"] {
            if let Ok(o) = Command::new("which").arg(bin).output() {
                if o.status.success() {
                    let p = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    if !p.is_empty() { return Some(p); }
                }
            }
        }
        None
    }
}

/// Launch Chrome with --remote-debugging-port=9222.
/// Spawns detached so it does not block. Returns the path used.
#[tauri::command]
pub async fn launch_chrome_debug() -> Result<String, String> {
    let chrome = find_chrome_path()
        .ok_or_else(|| "Chrome not found. Install Google Chrome and try again.".to_string())?;

    #[cfg(target_os = "windows")]
    {
        // On Windows use powershell Start-Process so the child is detached from our process tree
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!(
                    "Start-Process '{}' -ArgumentList '--remote-debugging-port=9222','--remote-debugging-address=127.0.0.1'",
                    chrome.replace("'", "''")
                ),
            ])
            .spawn()
            .map_err(|e| format!("Failed to launch Chrome: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(&chrome)
            .args(["--remote-debugging-port=9222", "--remote-debugging-address=127.0.0.1"])
            .spawn()
            .map_err(|e| format!("Failed to launch Chrome: {}", e))?;
    }

    Ok(chrome)
}

/// Check whether Chrome remote debugging is reachable on localhost:9222.
#[tauri::command]
pub async fn check_chrome_debug() -> Result<bool, String> {
    use std::net::TcpStream;
    use std::time::Duration;
    match TcpStream::connect_timeout(
        &"127.0.0.1:9222".parse().map_err(|e: std::net::AddrParseError| e.to_string())?,
        Duration::from_millis(800),
    ) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

// ─── Terminal streaming ───────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
pub struct ShellOutputEvent {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub text: String,
    pub stream: String, // "stdout" | "stderr"
}

#[derive(serde::Serialize, Clone)]
pub struct ShellExitEvent {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub code: i32,
}

/// Run a shell command and stream output line-by-line via Tauri events.
///
/// Events emitted:
///   `shell-output`  →  ShellOutputEvent  (one per output line)
///   `shell-exit`    →  ShellExitEvent    (when process exits)
#[tauri::command]
pub async fn shell_exec_streaming(
    session_id: String,
    command: String,
    cwd: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Platform-aware shell selection
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = TokioCommand::new("powershell");
        c.args(["-NoProfile", "-NonInteractive", "-Command", &command]);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = TokioCommand::new("bash");
        c.args(["-c", &command]);
        c
    };

    // Set working directory if provided and it exists
    if let Some(ref dir) = cwd {
        let p = Path::new(dir);
        if p.exists() {
            cmd.current_dir(p);
        }
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let app_out  = app_handle.clone();
    let app_err  = app_handle.clone();
    let sid_out  = session_id.clone();
    let sid_err  = session_id.clone();

    // Stream stdout
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_out.emit(
                "shell-output",
                ShellOutputEvent { session_id: sid_out.clone(), text: line, stream: "stdout".into() },
            );
        }
    });

    // Stream stderr
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_err.emit(
                "shell-output",
                ShellOutputEvent { session_id: sid_err.clone(), text: line, stream: "stderr".into() },
            );
        }
    });

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for shell: {}", e))?;

    // Ensure all output tasks finish before emitting exit
    let _ = tokio::join!(stdout_task, stderr_task);

    let _ = app_handle.emit(
        "shell-exit",
        ShellExitEvent {
            session_id,
            code: status.code().unwrap_or(-1),
        },
    );

    Ok(())
}

/// Resolve a path relative to `base_dir`. Returns the absolute resolved path.
/// Used by the terminal to update the CWD when the user runs `cd`.
#[tauri::command]
pub async fn shell_resolve_cwd(base_dir: String, target: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "Set-Location -Path '{}' -ErrorAction Stop; (Get-Location).Path",
            target.replace('\'', "''")
        );
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
        if !base_dir.is_empty() && Path::new(&base_dir).exists() {
            cmd.current_dir(&base_dir);
        }
        let output = cmd.output().map_err(|e| format!("shell_resolve_cwd: {}", e))?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
        } else {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let script = format!("cd '{}' && pwd", target.replace('\'', "'\\''"));
        let mut cmd = Command::new("bash");
        cmd.args(["-c", &script]);
        if !base_dir.is_empty() && Path::new(&base_dir).exists() {
            cmd.current_dir(&base_dir);
        }
        let output = cmd.output().map_err(|e| format!("shell_resolve_cwd: {}", e))?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
        } else {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
    }
}
