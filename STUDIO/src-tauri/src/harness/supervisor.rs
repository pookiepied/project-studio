use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;

#[cfg(windows)]
use windows::core::PCWSTR;
#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

use crate::harness::bootstrap::{generate_bootstrap, AdmissionBootstrap};
use crate::harness::channel::{BootstrapChannel, ReadinessStream};
use crate::harness::environment::apply_harness_environment;
use crate::harness::endpoint::{
    parse_readiness_line, HarnessEndpoint, HarnessEndpointView, HarnessReadiness,
};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

/// How long a signalled process group is given to exit before it is killed.
///
/// Unix only, and that is the point rather than an oversight: there is no
/// SIGTERM on Windows, so there is no polite request to wait out. See
/// `terminate_child`.
#[cfg(unix)]
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

/// How many lines of the child's own output are kept for a startup failure.
///
/// Bounded because on Windows the readiness stream *is* the child's stdout, so
/// an unbounded buffer is an unbounded buffer of whatever the Harness logs.
const DIAGNOSTIC_LINES: usize = 50;

/// Longest diagnostic excerpt put into an error message.
const DIAGNOSTIC_BYTES: usize = 2000;

/// Removes the per-launch bearer from anything about to be logged or returned.
///
/// Every diagnostic path goes through here rather than each one remembering.
/// The Harness echoes its own configuration on failure, and a startup error is
/// exactly the text a user pastes into a bug report.
/// Canonicalises a resolved server path, minus the prefix Windows adds.
///
/// `canonicalize` returns a verbatim path on Windows -- `\?\D:\...` -- and Node
/// reads the leading `\` as the start of a UNC share, so the main module it
/// tries to stat is `D:`. Measured, not predicted: the integration test failed
/// with `EISDIR: illegal operation on a directory, lstat 'D:'` on every run
/// until this stripped it, which is a defect the Unix-only source could not
/// have shown. The prefix exists to opt a path out of Win32 path parsing; a
/// path handed to a child process as an argument has no use for it.
///
/// The `\?\UNC\server\share` form is left alone. Stripping four characters from
/// that yields `UNC\server\share`, which is not the same path, and the Harness
/// is not loaded off a network share.
fn resolved(path: PathBuf) -> PathBuf {
    let path = path.canonicalize().unwrap_or(path);

    #[cfg(windows)]
    {
        if let Some(text) = path.to_str() {
            if let Some(stripped) = text.strip_prefix(r"\\?\") {
                if !stripped.starts_with(r"UNC\") {
                    return PathBuf::from(stripped);
                }
            }
        }
    }

    path
}

/// Crate-visible rather than private because the service seam now scrubs its
/// own error text with the same rule; two redaction helpers is how a token
/// ends up in exactly one of them.
pub(crate) fn redact(text: &str, token: &str) -> String {
    if token.is_empty() {
        return text.to_string();
    }
    text.replace(token, "[redacted]")
}

/// Keeps the tail of a diagnostic, on a character boundary.
///
/// Slicing a `String` by byte offset panics mid-codepoint, and this text is
/// whatever a child process wrote — including a path with a non-ASCII
/// character in it, which is ordinary on a Windows user profile.
fn tail(text: String) -> String {
    if text.len() <= DIAGNOSTIC_BYTES {
        return text;
    }
    let mut start = text.len() - DIAGNOSTIC_BYTES;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    format!("…{}", &text[start..])
}

/// Keeps the Harness and everything it starts inside one killable container.
///
/// One name, two mechanisms, the same shape as `channel.rs`. On Unix the
/// container is a process group and it is established *before* the spawn, by
/// `cmd.process_group(0)` in `spawn_child`, so there is nothing left for this
/// type to do afterwards. On Windows there is no process group, and the
/// counterpart -- a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` -- can
/// only be joined by a process that already exists, so it acts after the spawn.
///
/// The Windows half is meta-task **#89**: `cmd.process_group(0)` is
/// `#[cfg(unix)]` and had no counterpart, so an MCP server the Harness started
/// could outlive the Harness and keep holding a port or a file lock. Windows is
/// half of 1.0's platform scope, so "recorded rather than folded in" stopped
/// being good enough.
#[derive(Debug, Default)]
struct ProcessContainment {
    /// Created on the first spawn and held until the supervisor is dropped.
    /// Closing this handle is what kills the contents, so its lifetime *is* the
    /// containment -- it is deliberately not scoped to one child, because a
    /// restart must not release the descendants of the launch before it.
    #[cfg(windows)]
    job: Option<JobObject>,
}

impl ProcessContainment {
    /// Unix: `cmd.process_group(0)` already did it, before the child existed.
    #[cfg(unix)]
    fn contain(&mut self, _child: &Child) -> Result<(), String> {
        Ok(())
    }

    /// Windows: assign the child to the supervisor's Job Object, creating it on
    /// first use.
    ///
    /// There is a window between `spawn` and this call in which the child is in
    /// no job. `CREATE_SUSPENDED` would close it, and `std::process::Command`
    /// cannot ask for it; the alternative is a hand-rolled `CreateProcessW`,
    /// which would mean reimplementing stdio inheritance as well. The Harness
    /// starts no MCP server in that window -- it has not opened its database
    /// yet -- so the exposure is a few milliseconds of a process that has not
    /// begun its own work.
    #[cfg(windows)]
    fn contain(&mut self, child: &Child) -> Result<(), String> {
        let job = match self.job.as_ref() {
            Some(job) => job,
            None => {
                self.job = Some(JobObject::create()?);
                self.job.as_ref().expect("job object just created")
            }
        };
        job.assign(child)
    }
}

/// A Windows Job Object whose contents die when this handle closes.
///
/// `unsafe impl Send`/`Sync` because `HANDLE` wraps a raw pointer and is
/// therefore neither by default. A Win32 kernel handle is a process-wide
/// value -- any thread may use it, and the calls below are the only ones this
/// type makes -- so the marker is a statement about `HANDLE`'s representation,
/// not about this type doing anything clever.
#[cfg(windows)]
#[derive(Debug)]
struct JobObject {
    handle: HANDLE,
}

#[cfg(windows)]
unsafe impl Send for JobObject {}
#[cfg(windows)]
unsafe impl Sync for JobObject {}

#[cfg(windows)]
impl JobObject {
    fn create() -> Result<Self, String> {
        // Anonymous. A named job would be joinable by anything else on the
        // machine that guessed the name, and there is nothing to gain from one.
        let handle = unsafe { CreateJobObjectW(None, PCWSTR::null()) }
            .map_err(|e| format!("failed to create job object: {e}"))?;
        let job = Self { handle };

        // `KILL_ON_JOB_CLOSE` is the whole point: it makes the handle's lifetime
        // the contents' lifetime. It fires on any close, including the one the
        // kernel performs when this process dies -- so a Host that crashes still
        // takes its descendants with it, which a `shutdown_all` on exit cannot.
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        unsafe {
            SetInformationJobObject(
                job.handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        }
        .map_err(|e| format!("failed to configure job object: {e}"))?;

        Ok(job)
    }

    fn assign(&self, child: &Child) -> Result<(), String> {
        // The handle `std::process` already holds, rather than re-opening the
        // pid with `OpenProcess`. A pid can be reused between the two calls; a
        // handle cannot be, and this one carries full access already.
        let process = HANDLE(child.as_raw_handle());
        unsafe { AssignProcessToJobObject(self.handle, process) }
            .map_err(|e| format!("failed to assign harness to job object: {e}"))
    }
}

#[cfg(windows)]
impl Drop for JobObject {
    fn drop(&mut self) {
        // Every process still in the job dies here. That is the contract asked
        // for at creation, not a side effect of tidying up.
        let _ = unsafe { CloseHandle(self.handle) };
    }
}

#[derive(Debug)]
pub struct RunningHarness {
    pub child: Child,
    /// Carries the per-launch bearer itself, which is why there is no separate
    /// `token` field beside it. There was one; nothing ever read it, and the
    /// Windows compile is what finally said so (#87).
    pub endpoint: HarnessEndpoint,
}

#[derive(Debug, Default)]
struct Inner {
    running: Option<RunningHarness>,
    /// Last endpoint before stop, for stale-token checks in tests
    last_endpoint: Option<HarnessEndpoint>,
    start_count: u64,
    /// Why the last start attempt failed, if one did and none has succeeded
    /// since. See [`HarnessSupervisor::status`].
    last_error: Option<String>,
    containment: ProcessContainment,
}

/// What the webview is told when it asks how the Harness is doing.
///
/// A plain `Option<HarnessEndpoint>` could not distinguish "the eager start
/// failed thirty seconds ago" from "nothing has tried to start yet", and the
/// eager start happens before any window exists, so a failure had nowhere to go
/// but `log::error!`. A log line is not a thing a user can be shown. This is.
#[derive(Debug, Clone, Serialize)]
pub struct HarnessStatus {
    /// `running`, `failed`, or `stopped`.
    pub state: &'static str,
    /// Present exactly when `state` is `running`. The view, not the endpoint:
    /// this crosses to the webview and the bearer does not.
    pub endpoint: Option<HarnessEndpointView>,
    /// Present exactly when `state` is `failed`. Already redacted -- every
    /// error the supervisor produces goes through `redact` first.
    pub error: Option<String>,
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
                    return Ok(resolved(candidate));
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
                return Ok(resolved(c));
            }
        }
        // `pnpm build` in `STUDIO HARNESS/`, not `pnpm --filter project-studio-v2
        // build`. The package is named `project-studio-v2`, but it is not a
        // member of any workspace this repository defines -- `STUDIO/pnpm-workspace.yaml`
        // covers `STUDIO/` alone -- so there is nowhere `--filter` resolves it
        // from. Its `build` script is `flue build --target node`, which is what
        // writes `dist/server.mjs`.
        Err("Harness server not found. Run `pnpm build` in `STUDIO HARNESS/` and ensure dist/server.mjs exists.".to_string())
    }

    pub fn get_endpoint(&self) -> Option<HarnessEndpoint> {
        let mut guard = self.inner.lock().unwrap();
        Self::reap_dead_locked(&mut guard);
        guard.running.as_ref().map(|r| r.endpoint.clone())
    }

    pub fn start(&self) -> Result<HarnessEndpoint, String> {
        let mut guard = self.inner.lock().unwrap();
        Self::reap_dead_locked(&mut guard);
        if let Some(running) = &guard.running {
            return Ok(running.endpoint.clone());
        }
        // Kept, not just returned. `run()` starts the Harness on a background
        // thread before any window exists, so the caller that sees this error
        // is a thread with nobody to tell; `status` is how the webview learns
        // about it afterwards.
        let outcome = self.spawn_locked(&mut guard);
        let endpoint = Self::record(&mut guard, outcome)?;
        Ok(endpoint)
    }

    /// The state a UI can render, including a start that failed with no window
    /// yet open to receive the error.
    pub fn status(&self) -> HarnessStatus {
        // `get_endpoint` reaps a dead child first, so a Harness that exited
        // reports as failed-or-stopped here rather than as running.
        if let Some(endpoint) = self.get_endpoint() {
            return HarnessStatus {
                state: "running",
                endpoint: Some(endpoint.into()),
                error: None,
            };
        }

        let guard = self.inner.lock().unwrap();
        match guard.last_error.as_ref() {
            Some(error) => HarnessStatus {
                state: "failed",
                endpoint: None,
                error: Some(error.clone()),
            },
            None => HarnessStatus {
                state: "stopped",
                endpoint: None,
                error: None,
            },
        }
    }

    /// Remembers the outcome of a start attempt.
    ///
    /// A success clears the previous failure rather than leaving it beside a
    /// live endpoint, where the next reader would have to decide which of the
    /// two to believe.
    fn record(
        guard: &mut Inner,
        outcome: Result<HarnessEndpoint, String>,
    ) -> Result<HarnessEndpoint, String> {
        match &outcome {
            Ok(_) => guard.last_error = None,
            Err(error) => guard.last_error = Some(error.clone()),
        }
        outcome
    }

    pub fn restart(&self) -> Result<HarnessEndpoint, String> {
        let mut guard = self.inner.lock().unwrap();
        // Stop existing if any
        if let Some(mut running) = guard.running.take() {
            Self::terminate_child(&mut running.child);
            log::info!("Harness supervisor: stopped old harness pid={} for restart", running.endpoint.pid);
        }
        let outcome = self.spawn_locked(&mut guard);
        let endpoint = Self::record(&mut guard, outcome)?;
        log::info!(
            "Harness supervisor: restarted harness pid={} port={} session={}",
            endpoint.pid,
            endpoint.port,
            endpoint.session_id
        );
        Ok(endpoint)
    }

    // There was a `stop()` here with no caller anywhere in the crate. The app
    // stops the Harness through `shutdown_all` on window destruction and app
    // exit (`lib.rs`), and a second way to do the same thing that nothing used
    // is a second thing to keep correct. Removed with #87, when compiling on
    // Windows made the crate's dead code visible for the first time.

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

        let endpoint = Self::spawn_child(
            &mut guard.containment,
            server_path,
            bootstrap,
            token.clone(),
        )?;

        guard.running = Some(RunningHarness {
            child: endpoint.0,
            endpoint: endpoint.1.clone(),
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
        containment: &mut ProcessContainment,
        server_path: PathBuf,
        bootstrap: AdmissionBootstrap,
        token: String,
    ) -> Result<(Child, HarnessEndpoint), String> {
        // Prepare bootstrap JSON (credential + ids)
        let bootstrap_json = serde_json::to_string(&bootstrap)
            .map_err(|e| format!("failed to serialize bootstrap: {e}"))?;

        // Build command
        let mut cmd = Command::new("node");
        cmd.arg(&server_path);

        // The environment is decided in one place, not here. This used to read
        // "for now inherit all except credential", which handed the Harness
        // every API key, cloud credential and CI token in the shell that
        // launched the app, and protected exactly the one variable someone
        // remembered to remove. See `environment.rs` and meta-task #74.
        //
        // It runs before the four below on purpose: it clears, so anything set
        // first would be wiped, and anything the host happens to export under
        // these names cannot shadow what we set deliberately.
        apply_harness_environment(&mut cmd);

        cmd.env("PORT", "0");
        cmd.env("PROJECT_STUDIO_HARNESS_HOSTNAME", "127.0.0.1");
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Attached after the environment policy and the explicit variables,
        // because it sets two more of its own and `apply_harness_environment`
        // clears. It also owns `stdin`, which differs by platform: null on
        // Unix, the bootstrap pipe on Windows.
        let channel = BootstrapChannel::attach(&mut cmd)?;

        // Put the Harness and every descendant it starts in one process group.
        // The Host owns the group, not just the Node parent, so an MCP child
        // cannot survive a Harness crash/restart and retain a port or file.
        //
        // This is the Unix half only, because a process group is the one part
        // of the containment that has to be requested before the spawn. The
        // Windows half is a Job Object and is joined after it -- see
        // `ProcessContainment` and the `containment.contain` call below.
        #[cfg(unix)]
        cmd.process_group(0);

        let mut child = cmd.spawn().map_err(|e| format!("failed to spawn node harness: {e} (path={})", server_path.display()))?;

        // The other half of the containment above, for the platform that can
        // only do it once the process exists. Fatal rather than logged: a
        // Harness outside the job is one whose MCP children can outlive it,
        // which is the condition this exists to prevent.
        if let Err(error) = containment.contain(&child) {
            Self::terminate_child(&mut child);
            return Err(error);
        }

        let readiness_stream = match channel.deliver(&mut child, &bootstrap_json) {
            Ok(stream) => stream,
            Err(error) => {
                Self::terminate_child(&mut child);
                return Err(error);
            }
        };

        // Read readiness with timeout
        let readiness = Self::wait_for_readiness(readiness_stream, &mut child, &token)?;

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

        // Startup is over, so nothing is reading the child's pipes any more.
        // From here they are drained for their whole life, not sampled on
        // failure.
        Self::drain_output(&mut child);

        Ok((child, endpoint))
    }

    /// Waits for the readiness frame, or explains why it never came.
    ///
    /// Reads lines rather than *a* line. The previous version started a thread,
    /// read exactly one line, and failed if that line was not the frame — which
    /// worked only because fd 3 carried nothing else. On Windows the readiness
    /// stream is the child's stdout and the Harness's own logging shares it, so
    /// "the first line" is `[flue] Server listening on …`.
    ///
    /// `stream.exclusive` keeps the Unix strictness intact rather than relaxing
    /// both platforms to the weaker rule: on a dedicated descriptor, anything
    /// that is not the frame is a fault and is still reported as one.
    fn wait_for_readiness(
        stream: ReadinessStream,
        child: &mut Child,
        token: &str,
    ) -> Result<HarnessReadiness, String> {
        use std::sync::mpsc;

        let start = Instant::now();
        let exclusive = stream.exclusive;
        let mut buf_reader = BufReader::new(stream.reader);

        // A reader thread, because neither an anonymous pipe nor a child's
        // stdout can be read with a timeout. It sends every line and then
        // closes the channel, so the loop below sees EOF as a disconnect.
        //
        // Once the receiver is gone — startup finished, one way or another —
        // it does **not** stop. It keeps reading and drops what it reads. On
        // Windows this stream is the child's stdout, and a reader that returns
        // here would close the pipe under a Harness that logs for the rest of
        // its life: every later write fails, and on a full buffer it blocks
        // before it fails.
        let (tx, rx) = mpsc::channel::<Result<String, String>>();
        std::thread::spawn(move || {
            let mut startup_owner_listening = true;
            loop {
                let mut line = String::new();
                match buf_reader.read_line(&mut line) {
                    Ok(0) => return,
                    Ok(_) => {
                        if startup_owner_listening && tx.send(Ok(line.clone())).is_err() {
                            startup_owner_listening = false;
                        }
                        if !startup_owner_listening && !line.trim().is_empty() {
                            log::debug!("harness stdout: {}", line.trim());
                        }
                    }
                    Err(error) => {
                        if startup_owner_listening {
                            let _ = tx.send(Err(error.to_string()));
                        }
                        return;
                    }
                }
            }
        });

        // Lines seen before the frame. On Windows these are the Harness's own
        // startup output and are the most useful thing to show when it fails.
        let mut seen: VecDeque<String> = VecDeque::new();
        let mut remember = |line: &str| {
            if seen.len() == DIAGNOSTIC_LINES {
                seen.pop_front();
            }
            seen.push_back(line.to_string());
        };

        let describe = |seen: &VecDeque<String>, child: &mut Child, token: &str| -> String {
            let observed = seen
                .iter()
                .map(|line| line.trim())
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            let observed = redact(&observed, token);
            let (stdout, stderr) = Self::collect_output(child, token);
            format!(
                "observed={} stdout={} stderr={}",
                if observed.is_empty() { "(nothing)" } else { &observed },
                if stdout.is_empty() { "(nothing)" } else { &stdout },
                if stderr.is_empty() { "(nothing)" } else { &stderr }
            )
        };

        loop {
            if start.elapsed() > STARTUP_TIMEOUT {
                Self::terminate_child(child);
                return Err(format!(
                    "Harness did not publish loopback readiness within {}ms. {}",
                    STARTUP_TIMEOUT.as_millis(),
                    describe(&seen, child, token)
                ));
            }

            // Checked before the channel, so an exit is reported as an exit
            // rather than as the disconnect it also produces.
            match child.try_wait() {
                Ok(Some(status)) => {
                    return Err(format!(
                        "Harness exited before readiness (status={status}). {}",
                        describe(&seen, child, token)
                    ));
                }
                Ok(None) => {}
                Err(e) => return Err(format!("failed to poll child: {e}")),
            }

            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(Ok(line)) => {
                    let trimmed = line.trim();
                    if let Some(readiness) = parse_readiness_line(trimmed) {
                        return Ok(readiness);
                    }
                    if exclusive {
                        return Err(format!(
                            "Harness readiness malformed: {}. {}",
                            redact(trimmed, token),
                            describe(&seen, child, token)
                        ));
                    }
                    // Shared stream: this is the Harness talking, not a fault.
                    remember(trimmed);
                }
                Ok(Err(e)) => return Err(format!("failed to read readiness: {e}")),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(format!(
                        "Harness readiness stream closed without a frame. {}",
                        describe(&seen, child, token)
                    ));
                }
            }
        }
    }

    /// Keeps the child's remaining output moving once startup has succeeded.
    ///
    /// Not cosmetic. A piped stream nobody reads fills its buffer and then
    /// blocks the writer, so an undrained pipe is a Harness that freezes the
    /// first time it logs enough. That was already latent for `stderr` on both
    /// platforms; the readiness reader now covers `stdout` on Windows, and this
    /// covers what is left.
    fn drain_output(child: &mut Child) {
        fn pump<R: Read + Send + 'static>(label: &'static str, reader: R) {
            std::thread::spawn(move || {
                for line in BufReader::new(reader).lines().map_while(Result::ok) {
                    if !line.trim().is_empty() {
                        log::debug!("harness {label}: {}", line.trim());
                    }
                }
            });
        }

        // Already taken on Windows, where it is the readiness stream.
        if let Some(stdout) = child.stdout.take() {
            pump("stdout", stdout);
        }
        if let Some(stderr) = child.stderr.take() {
            pump("stderr", stderr);
        }
    }

    /// Drains what is left of the child's pipes for a startup failure message.
    ///
    /// Only ever called on a path that ends in an error. On Windows `stdout` is
    /// already taken — it is the readiness stream — so the lines that would
    /// have appeared here arrive as `observed=` instead.
    fn collect_output(child: &mut Child, token: &str) -> (String, String) {
        let mut stdout = String::new();
        let mut stderr = String::new();
        if let Some(mut out) = child.stdout.take() {
            let _ = out.read_to_string(&mut stdout);
        }
        if let Some(mut err) = child.stderr.take() {
            let _ = err.read_to_string(&mut stderr);
        }
        (tail(redact(&stdout, token)), tail(redact(&stderr, token)))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Long text keeps its tail, and does not panic doing it.
    ///
    /// `tail` slices by byte offset, and the text it slices is whatever a child
    /// process wrote -- a Windows user profile path with a non-ASCII character
    /// in it is ordinary, and landing mid-codepoint would abort the very error
    /// report that was trying to explain a failure.
    #[test]
    fn a_diagnostic_is_trimmed_on_a_character_boundary() {
        let text = "e\u{301}".repeat(DIAGNOSTIC_BYTES);
        let trimmed = tail(text);
        assert!(trimmed.starts_with('\u{2026}'));
        assert!(trimmed.len() <= DIAGNOSTIC_BYTES + 4);
    }

    /// The bearer never survives into a message anyone will read.
    #[test]
    fn redaction_removes_the_token_wherever_it_appears() {
        let redacted = redact("listening with token=abc123 (token=abc123)", "abc123");
        assert!(!redacted.contains("abc123"));
        assert_eq!(redacted.matches("[redacted]").count(), 2);
        // An empty token is not a substring to replace; it is every position.
        assert_eq!(redact("anything", ""), "anything");
    }

    /// The path handed to Node is one Node can open.
    ///
    /// On Windows `canonicalize` returns `\?\D:\...`, which Node parses as a
    /// UNC share and fails on with `EISDIR ... lstat 'D:'`. See `resolved`.
    #[test]
    fn the_resolved_server_path_carries_no_verbatim_prefix() {
        let supervisor = HarnessSupervisor::new();
        let path = supervisor
            .resolve_server_path()
            .expect("dist/server.mjs must exist; run `pnpm build` in `STUDIO HARNESS/`");
        assert!(path.exists());
        assert!(
            !path.to_string_lossy().starts_with(r"\?\"),
            "node cannot open a verbatim path: {}",
            path.display()
        );
    }

    /// The Windows counterpart to `process_group(0)` actually contains a child.
    ///
    /// Asserted against *this* job rather than "any job", because a child
    /// inherits its parent's job membership on Windows and a test runner is
    /// often already in one -- so `IsProcessInJob(child, None)` would have been
    /// true before this code existed and would have proved nothing.
    #[test]
    #[cfg(windows)]
    fn a_contained_child_joins_the_supervisors_job() {
        use windows::core::BOOL;
        use windows::Win32::System::JobObjects::IsProcessInJob;

        let mut containment = ProcessContainment::default();
        let mut child = Command::new("cmd")
            .args(["/c", "ping -n 5 127.0.0.1 >NUL"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn a short-lived child");

        containment.contain(&child).expect("contain the child");
        let job = containment.job.as_ref().expect("a job object was created");

        let mut member = BOOL::default();
        unsafe {
            IsProcessInJob(
                HANDLE(child.as_raw_handle()),
                Some(job.handle),
                &mut member as *mut BOOL,
            )
        }
        .expect("query job membership");

        assert!(member.as_bool(), "the child was not assigned to the job");

        let _ = child.kill();
        let _ = child.wait();
    }
}
