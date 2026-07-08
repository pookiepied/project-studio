/// Local Provider Daemon — bridges local LLMs (Ollama, LM Studio) to cloud AI
///
/// Manages a background Node.js process that exposes local language models
/// via an OpenAI-compatible HTTP API at localhost:11435.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Default)]
pub struct DaemonStartConfig {
    pub port: Option<u16>,
    pub ollama_base_url: Option<String>,
    pub lm_studio_base_url: Option<String>,
}

/// Emitted on the "local-provider-status" event whenever daemon starts or stops
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DaemonStatusEvent {
    pub running: bool,
    pub port: u16,
    pub error: Option<String>,
}

/// Tauri-managed state for the Local Provider Daemon
pub struct DaemonHandle {
    running: Arc<AtomicBool>,
    port: Arc<Mutex<u16>>,
    child: Arc<Mutex<Option<std::process::Child>>>,
}

impl DaemonHandle {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            port: Arc::new(Mutex::new(11435)),
            child: Arc::new(Mutex::new(None)),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn port(&self) -> u16 {
        self.port.lock().map(|p| *p).unwrap_or(11435)
    }

    /// Start the daemon process
    pub fn start(&self, app: AppHandle, config: DaemonStartConfig) -> Result<(), String> {
        if self.is_running() {
            return Err("Daemon is already running".to_string());
        }

        let requested_port = config.port.unwrap_or_else(|| self.port());

        // Construct path to daemon server
        let daemon_path = if cfg!(debug_assertions) {
            // Development: CARGO_MANIFEST_DIR is src-tauri/, daemon lives one level up
            format!("{}/../daemon/dist/server.js", env!("CARGO_MANIFEST_DIR"))
        } else {
            // Production: daemon is bundled next to the app binary
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                .unwrap_or_default();
            exe_dir.join("daemon/dist/server.js").to_string_lossy().into_owned()
        };

        // Check if daemon executable exists (optional check to provide better error)
        if !std::path::Path::new(&daemon_path).exists() {
            let error_msg = format!("Daemon not found at: {}", daemon_path);
            let _ = app.emit(
                "local-provider-status",
                DaemonStatusEvent {
                    running: false,
                    port: requested_port,
                    error: Some(error_msg.clone()),
                },
            );
            return Err(error_msg);
        }

        // Spawn daemon process
        let mut command = std::process::Command::new("node");
        command
            .arg(&daemon_path)
            .env("LOCAL_PROVIDER_PORT", requested_port.to_string());

        if let Some(ollama_base_url) = config.ollama_base_url {
            if !ollama_base_url.trim().is_empty() {
                command.env("OLLAMA_BASE_URL", ollama_base_url);
            }
        }

        if let Some(lm_studio_base_url) = config.lm_studio_base_url {
            if !lm_studio_base_url.trim().is_empty() {
                command.env("LM_STUDIO_BASE_URL", lm_studio_base_url);
            }
        }

        let child = command
            .spawn()
            .map_err(|e| format!("Failed to spawn daemon process: {}", e))?;

        if let Ok(mut port_lock) = self.port.lock() {
            *port_lock = requested_port;
        }

        let mut child_lock = self.child.lock().map_err(|e| e.to_string())?;
        *child_lock = Some(child);

        self.running.store(true, Ordering::Relaxed);

        // Emit status event
        let _ = app.emit(
            "local-provider-status",
            DaemonStatusEvent {
                running: true,
                port: requested_port,
                error: None,
            },
        );

        Ok(())
    }

    /// Stop the daemon process
    pub fn stop(&self, app: AppHandle) {
        if let Ok(mut child_lock) = self.child.lock() {
            if let Some(mut child) = child_lock.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }

        self.running.store(false, Ordering::Relaxed);

        let _ = app.emit(
            "local-provider-status",
            DaemonStatusEvent {
                running: false,
                port: self.port(),
                error: None,
            },
        );
    }
}

impl Drop for DaemonHandle {
    fn drop(&mut self) {
        if let Ok(mut child_lock) = self.child.lock() {
            if let Some(mut child) = child_lock.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}
