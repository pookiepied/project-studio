use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::{io::AsRawFd, process::CommandExt};

use command_fds::{CommandFdExt, FdMapping};
use os_pipe::PipeReader;

use crate::harness::bootstrap::{generate_bootstrap, AdmissionBootstrap};
use crate::harness::endpoint::{parse_readiness_line, HarnessEndpoint, HarnessReadiness};

const READINESS_FD: i32 = 3;
const BOOTSTRAP_FD: i32 = 4;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub struct RunningHarness {
    pub child: Child,
    pub endpoint: HarnessEndpoint,
    pub token: String,
    // We keep the pipe readers/writers to prevent early close? Not needed after spawn.
}

#[derive(Debug, Default)]
struct Inner {
    running: Option<RunningHarness>,
    /// Last endpoint before stop, for stale-token checks in tests
    last_endpoint: Option<HarnessEndpoint>,
    start_count: u64,
}

#[derive(Debug, Clone)]
pub struct HarnessSupervisor {
    inner: Arc<Mutex<Inner>>,
}

impl Default for HarnessSupervisor {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
        }
    }
}

impl HarnessSupervisor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Resolve the built Harness server entrypoint.
    /// Tries, in order:
    /// 1. Tauri resource dir `harness/server.mjs` (bundled production)
    /// 2. `../STUDIO HARNESS/dist/server.mjs` relative to `src-tauri` (dev)
    /// 3. `./STUDIO HARNESS/dist/server.mjs` relative to current dir
    pub fn resolve_server_path(&self) -> Result<PathBuf, String> {
        // 1. Try resource dir via exe location
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                // In dev, exe is target/debug/studio - resources not there
                let candidate = exe_dir.join("../resources/harness/server.mjs");
                if candidate.exists() {
                    return Ok(candidate.canonicalize().unwrap_or(candidate));
                }
                let candidate2 = exe_dir.join("resources/harness/server.mjs");
                if candidate2.exists() {
                    return Ok(candidate2);
                }
            }
        }
        // 2. Relative to src-tauri (dev)
        let candidates = [
            PathBuf::from("../STUDIO HARNESS/dist/server.mjs"),
            PathBuf::from("./STUDIO HARNESS/dist/server.mjs"),
            PathBuf::from("../../STUDIO HARNESS/dist/server.mjs"),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../STUDIO HARNESS/dist/server.mjs"),
        ];
        for c in candidates {
            if c.exists() {
                return Ok(c.canonicalize().unwrap_or(c));
            }
        }
        Err("Harness server not found. Run `pnpm --filter project-studio-v2 build` in STUDIO HARNESS and ensure dist/server.mjs exists.".to_string())
    }

    pub fn is_running(&self) -> bool {
        self.get_endpoint().is_some()
    }

    pub fn get_endpoint(&self) -> Option<HarnessEndpoint> {
        let mut guard = self.inner.lock().unwrap();
        Self::reap_dead_locked(&mut guard);
        guard.running.as_ref().map(|r| r.endpoint.clone())
    }

    pub fn start(&self) -> Result<HarnessEndpoint, String> {
        let mut guard = self.inner.lock().unwrap();
        Self::reap_dead_locked(&mut guard);
        if guard.running.is_some() {
            return Ok(guard.running.as_ref().unwrap().endpoint.clone());
        }
        let endpoint = self.spawn_locked(&mut guard)?;
        Ok(endpoint)
    }

    pub fn restart(&self) -> Result<HarnessEndpoint, String> {
        let mut guard = self.inner.lock().unwrap();
        // Stop existing if any
        if let Some(mut running) = guard.running.take() {
            Self::terminate_child(&mut running.child);
            log::info!("Harness supervisor: stopped old harness pid={} for restart", running.endpoint.pid);
        }
        let endpoint = self.spawn_locked(&mut guard)?;
        log::info!(
            "Harness supervisor: restarted harness pid={} port={} session={}",
            endpoint.pid,
            endpoint.port,
            endpoint.session_id
        );
        Ok(endpoint)
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().unwrap();
        if let Some(mut running) = guard.running.take() {
            Self::terminate_child(&mut running.child);
            guard.last_endpoint = Some(running.endpoint.clone());
            log::info!("Harness supervisor: stopped harness pid={}", running.endpoint.pid);
        }
        Ok(())
    }

    fn spawn_locked(&self, guard: &mut Inner) -> Result<HarnessEndpoint, String> {
        let server_path = self.resolve_server_path()?;
        let client_id = "studio-host".to_string();
        let generated = generate_bootstrap(client_id);
        let bootstrap = generated.bootstrap.clone();
        let token = generated.credential_raw.clone();

        log::info!(
            "Harness supervisor: spawning harness server={} client_id={} session_id={}",
            server_path.display(),
            bootstrap.client_id,
            bootstrap.session_id
        );

        let endpoint = Self::spawn_child(server_path, bootstrap, token.clone())?;

        guard.running = Some(RunningHarness {
            child: endpoint.0,
            endpoint: endpoint.1.clone(),
            token: token.clone(),
        });
        guard.start_count += 1;
        guard.last_endpoint = Some(endpoint.1.clone());

        // Do not log token
        log::info!(
            "Harness supervisor: harness ready pid={} {}:{} session={} (token redacted)",
            endpoint.1.pid,
            endpoint.1.host,
            endpoint.1.port,
            endpoint.1.session_id
        );

        Ok(endpoint.1)
    }

    fn spawn_child(
        server_path: PathBuf,
        bootstrap: AdmissionBootstrap,
        token: String,
    ) -> Result<(Child, HarnessEndpoint), String> {
        // Create pipes
        let (bootstrap_reader, mut bootstrap_writer) =
            os_pipe::pipe().map_err(|e| format!("failed to create bootstrap pipe: {e}"))?;
        let (readiness_reader, readiness_writer) =
            os_pipe::pipe().map_err(|e| format!("failed to create readiness pipe: {e}"))?;

        // Prepare bootstrap JSON (credential + ids)
        let bootstrap_json = serde_json::to_string(&bootstrap)
            .map_err(|e| format!("failed to serialize bootstrap: {e}"))?;

        // Build command
        let mut cmd = Command::new("node");
        cmd.arg(&server_path);
        cmd.env("PORT", "0");
        cmd.env("PROJECT_STUDIO_HARNESS_HOSTNAME", "127.0.0.1");
        cmd.env("PROJECT_STUDIO_READINESS_FD", READINESS_FD.to_string());
        cmd.env("PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD", BOOTSTRAP_FD.to_string());
        // Ensure credential not in env
        cmd.env_remove("PROJECT_STUDIO_ADMISSION_CREDENTIAL");
        // Inherit filtered env: keep PATH, HOME etc but not secrets? For now inherit all except credential.
        // Cargo sets many vars; we just remove credential.
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Put the Harness and every descendant it starts in one process group.
        // The Host owns the group, not just the Node parent, so an MCP child
        // cannot survive a Harness crash/restart and retain a port or file.
        #[cfg(unix)]
        cmd.process_group(0);

        // Map fds: bootstrap_reader -> 4 (read), readiness_writer -> 3 (write)
        // command-fds will handle CLOEXEC and dup2
        let bootstrap_fd_mapping = FdMapping {
            parent_fd: bootstrap_reader.as_raw_fd(),
            child_fd: BOOTSTRAP_FD,
        };
        let readiness_fd_mapping = FdMapping {
            parent_fd: readiness_writer.as_raw_fd(),
            child_fd: READINESS_FD,
        };
        cmd.fd_mappings(vec![bootstrap_fd_mapping, readiness_fd_mapping])
            .map_err(|e| format!("failed to map fds: {e}"))?;

        // Keep pipes open until spawn; prevent close-on-exec for mapped fds is handled by command-fds
        let mut child = cmd.spawn().map_err(|e| format!("failed to spawn node harness: {e} (path={})", server_path.display()))?;

        // Close child's copies in parent; we keep our ends
        drop(bootstrap_reader);
        drop(readiness_writer);

        // Write bootstrap and close writer (signals EOF to child)
        // Child reads fd 4 as file; it will read once and close
        let bootstrap_clone = bootstrap_json.clone();
        // Write in a thread to avoid blocking?
        // For small JSON, direct write is fine.
        bootstrap_writer
            .write_all(bootstrap_clone.as_bytes())
            .map_err(|e| {
                Self::terminate_child(&mut child);
                format!("failed to write bootstrap: {e}")
            })?;
        drop(bootstrap_writer); // EOF

        // Read readiness with timeout
        let readiness = Self::wait_for_readiness(readiness_reader, &mut child, &token)?;

        // Verify endpoint host is loopback
        if readiness.host != "127.0.0.1" {
            Self::terminate_child(&mut child);
            return Err(format!("harness readiness host must be 127.0.0.1, got {}", readiness.host));
        }

        let endpoint = HarnessEndpoint::from_readiness(readiness, token.clone())
            .ok_or_else(|| {
                Self::terminate_child(&mut child);
                "invalid readiness frame".to_string()
            })?;

        Ok((child, endpoint))
    }

    fn wait_for_readiness(
        reader: PipeReader,
        child: &mut Child,
        token: &str,
    ) -> Result<HarnessReadiness, String> {
        let start = Instant::now();
        let mut buf_reader = BufReader::new(reader);

        // We need to poll both pipe and child exit. Use non-blocking with timeout.
        // Simplify: set pipe to non-blocking and poll
        // os_pipe reader is blocking; we will read with timeout via thread + channel
        use std::sync::mpsc;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let result = buf_reader.read_line(&mut line);
            let _ = tx.send((result, line));
        });

        loop {
            if start.elapsed() > STARTUP_TIMEOUT {
                Self::terminate_child(child);
                // Collect stdout/stderr for diagnostics, redacted
                let (stdout, stderr) = Self::collect_output(child, token);
                return Err(format!(
                    "Harness did not publish loopback readiness within {}ms.\nstdout={}\nstderr={}",
                    STARTUP_TIMEOUT.as_millis(),
                    if stdout.is_empty() { "(nothing)" } else { &stdout },
                    if stderr.is_empty() { "(nothing)" } else { &stderr }
                ));
            }

            // Check if child exited
            match child.try_wait() {
                Ok(Some(status)) => {
                    let (stdout, stderr) = Self::collect_output(child, token);
                    return Err(format!(
                        "Harness exited before readiness (status={}). stdout={} stderr={}",
                        status,
                        if stdout.is_empty() { "(nothing)" } else { &stdout },
                        if stderr.is_empty() { "(nothing)" } else { &stderr }
                    ));
                }
                Ok(None) => {}
                Err(e) => {
                    return Err(format!("failed to poll child: {e}"));
                }
            }

            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok((Ok(0), _)) => {
                    // EOF without line
                    let (stdout, stderr) = Self::collect_output(child, token);
                    return Err(format!(
                        "Harness readiness pipe closed without frame. stdout={} stderr={}",
                        if stdout.is_empty() { "(nothing)" } else { &stdout },
                        if stderr.is_empty() { "(nothing)" } else { &stderr }
                    ));
                }
                Ok((Ok(_), line)) => {
                    if let Some(readiness) = parse_readiness_line(line.trim()) {
                        return Ok(readiness);
                    } else {
                        // Not a readiness line - could be noise? Continue waiting
                        // But FD 3 should only have readiness JSON; ignore malformed
                        log::warn!("Harness supervisor: ignoring non-readiness line on FD 3: {}", line.trim());
                        // Need to continue reading - but our thread already consumed one line.
                        // For simplicity, if first line not readiness, fail
                        let (stdout, stderr) = Self::collect_output(child, token);
                        return Err(format!(
                            "Harness readiness malformed: {}. stdout={} stderr={}",
                            line.trim(),
                            if stdout.is_empty() { "(nothing)" } else { &stdout },
                            if stderr.is_empty() { "(nothing)" } else { &stderr }
                        ));
                    }
                }
                Ok((Err(e), _)) => {
                    return Err(format!("failed to read readiness: {e}"));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    continue;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    let (stdout, stderr) = Self::collect_output(child, token);
                    return Err(format!(
                        "Harness readiness thread disconnected. stdout={} stderr={}",
                        if stdout.is_empty() { "(nothing)" } else { &stdout },
                        if stderr.is_empty() { "(nothing)" } else { &stderr }
                    ));
                }
            }
        }
    }

    fn collect_output(child: &mut Child, token: &str) -> (String, String) {
        let mut stdout = String::new();
        let mut stderr = String::new();
        if let Some(mut out) = child.stdout.take() {
            let _ = out.read_to_string(&mut stdout);
        }
        if let Some(mut err) = child.stderr.take() {
            let _ = err.read_to_string(&mut stderr);
        }
        // Redact token
        let stdout_redacted = stdout.replace(token, "[redacted]");
        let stderr_redacted = stderr.replace(token, "[redacted]");
        // Tail 2000
        let tail = |s: String| {
            if s.len() > 2000 {
                format!("…{}", &s[s.len() - 2000..])
            } else {
                s
            }
        };
        (tail(stdout_redacted), tail(stderr_redacted))
    }

    fn terminate_child(child: &mut Child) {
        // Try SIGTERM then SIGKILL, addressing the whole process group on Unix.
        // The root may already have exited, but descendants can still be alive.
        #[cfg(unix)]
        {
            let pid = child.id() as i32;
            let group = nix::unistd::Pid::from_raw(-pid);
            let _ = nix::sys::signal::kill(group, nix::sys::signal::Signal::SIGTERM);

            if child.try_wait().ok().flatten().is_none() {
                let start = Instant::now();
                while start.elapsed() < SHUTDOWN_GRACE {
                    match child.try_wait() {
                        Ok(Some(_)) => break,
                        Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                        Err(_) => break,
                    }
                }
            }

            let _ = nix::sys::signal::kill(group, nix::sys::signal::Signal::SIGKILL);
            let _ = child.kill();
            let _ = child.wait();
        }
        #[cfg(not(unix))]
        {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn reap_dead_locked(guard: &mut Inner) {
        let exited = guard
            .running
            .as_mut()
            .and_then(|running| running.child.try_wait().ok().flatten())
            .is_some();

        if !exited {
            return;
        }

        if let Some(mut running) = guard.running.take() {
            Self::terminate_child(&mut running.child);
            guard.last_endpoint = Some(running.endpoint);
        }
    }

    pub fn shutdown_all(&self) {
        let mut guard = self.inner.lock().unwrap();
        if let Some(mut running) = guard.running.take() {
            log::info!("Harness supervisor: shutting down harness pid={}", running.endpoint.pid);
            Self::terminate_child(&mut running.child);
        }
    }
}
