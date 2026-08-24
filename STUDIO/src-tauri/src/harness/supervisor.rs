use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};

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

use tauri::{AppHandle, Emitter};

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

/// How long the polite shutdown request waits to be acknowledged.
///
/// The Harness answers `POST /api/shutdown` before it begins draining -- the
/// response is fire-and-forget on its side -- so on loopback the answer should
/// arrive in milliseconds. Five seconds tolerates a paused process without
/// letting a quit hang on a request that will never be answered.
const SHUTDOWN_ACK_TIMEOUT: Duration = Duration::from_secs(5);

/// How long a drain may take before the fallback termination runs.
///
/// The bound matters more than its value: a drain that waits forever is a
/// window that will not close. Ten seconds is generous headroom over the work
/// a graceful shutdown honestly does -- stop each MCP server (awaited, each
/// typically well under a second) and close two SQLite databases (checkpoint
/// included, sub-second on local disk) -- because nothing in it waits for an
/// in-flight model turn: unfinished submissions stay reclaimable by design
/// (ADR 0032 §3). Past the bound, today's termination is the answer, and the
/// log line that precedes it is how we learn the mechanism broke.
const DRAIN_BOUND: Duration = Duration::from_secs(10);

/// How long a crash may be followed by an automatic restart.
///
/// Once per window, not once ever: a harness that crashes again within sixty
/// seconds of the last unexpected exit is one the replacement did not save,
/// and restarting it in a loop looks like activity while fixing nothing.
/// Sixty seconds is two startup budgets -- a harness that cannot start
/// demonstrates that within [`STARTUP_TIMEOUT`] -- so the window always spans
/// enough to see the restart fail, and never strands a user whose harness
/// crashed twice an hour ago.
const RESTART_WINDOW: Duration = Duration::from_secs(60);

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

/// What the supervisor tells the webview as the Harness lifecycle moves.
///
/// The names are the contract the frontend subscribes to; the payloads are
/// narrow on purpose. [`LifecycleEvent::Started`] carries the endpoint *view*
/// -- `HarnessEndpoint` cannot be serialized, so the bearer physically cannot
/// ride the event -- and [`LifecycleEvent::Failed`] carries a sentence that is
/// redacted at its source like every other diagnostic.
#[derive(Debug, Clone)]
pub(crate) enum LifecycleEvent {
    Starting,
    Started(HarnessEndpointView),
    Stopped,
    Failed(String),
    Restarting,
}

impl LifecycleEvent {
    pub(crate) fn name(&self) -> &'static str {
        match self {
            LifecycleEvent::Starting => "harness-starting",
            LifecycleEvent::Started(_) => "harness-started",
            LifecycleEvent::Stopped => "harness-stopped",
            LifecycleEvent::Failed(_) => "harness-failed",
            LifecycleEvent::Restarting => "harness-restarting",
        }
    }
}

/// Serialised flat rather than wrapped, so a subscriber reads the view or the
/// message directly instead of unwrapping `{ payload: ... }` first.
impl Serialize for LifecycleEvent {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            LifecycleEvent::Started(view) => view.serialize(serializer),
            LifecycleEvent::Failed(message) => message.serialize(serializer),
            LifecycleEvent::Starting | LifecycleEvent::Stopped | LifecycleEvent::Restarting => {
                serializer.serialize_unit()
            }
        }
    }
}

/// Receives every lifecycle event, named and carrying its payload.
///
/// A closure rather than a Tauri type so the supervisor's tests can record
/// events without an application, so this module never imports more of Tauri
/// than the emitter wiring, and so emission is defined as "tell whoever is
/// listening" -- which is nobody, correctly, before any webview exists.
pub(crate) type LifecycleSink = Box<dyn Fn(&LifecycleEvent) + Send + Sync>;

/// Keeps the Harness and everything it starts inside one killable container.
///
/// One name, two mechanisms, the same shape as `channel.rs`. On Unix the
/// container is a process group and it is established *before* the spawn, by
/// `cmd.process_group(0)` in `launch`, so there is nothing left for this type
/// to do afterwards. On Windows there is no process group, and the counterpart
/// -- a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` -- can only be
/// joined by a process that already exists, so it acts after the spawn.
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
    /// Why the last start attempt failed, or why the last unexpected exit
    /// happened, if either did and nothing healthy has happened since. See
    /// [`HarnessSupervisor::status`].
    last_error: Option<String>,
    /// True while a spawn is in flight. The spawn does its waiting *without*
    /// the lock (see [`HarnessSupervisor::spawn`]), so this flag is how
    /// `status` answers `starting` instead of blocking behind the spawn, and
    /// how a concurrent `start` waits rather than double-spawning.
    starting: bool,
    /// Set by `shutdown_all` while a spawn is in flight. The spawn polls it
    /// throughout the readiness wait and lands its child dead rather than
    /// installing a harness nobody wants; without it, quitting during the
    /// startup window could bring a Harness to life behind the app's back.
    abort_start: bool,
    /// True between "a stop was asked of the live child" and that child being
    /// reaped. An exit under this flag is the stop landing, not a crash: it
    /// reports `stopped` rather than `failed`, and restarts nothing. Reset on
    /// install, on reap, and wherever a stop sequence finishes, so a stale
    /// flag can never teach the next crash to masquerade as a stop.
    expected_exit: bool,
    /// When the last unexpected exit was observed. Bounds automatic restarts
    /// to once per [`RESTART_WINDOW`].
    last_unexpected_exit: Option<Instant>,
    containment: ProcessContainment,
}

/// The supervisor's shared state, split by holding time.
///
/// `state` guards bookkeeping and is held only for the length of a field
/// update; the long work of a spawn runs without it. `spawn_settled` wakes the
/// callers waiting on an in-flight spawn. `lifecycle` is held for the length
/// of one callback, and no callback ever takes `state`, so the two cannot
/// cycle. This split *is* Part 3: a lock held across spawn plus readiness was
/// a status call that waited up to thirty seconds for an answer it could have
/// given immediately.
#[derive(Default)]
struct Shared {
    state: Mutex<Inner>,
    spawn_settled: Condvar,
    lifecycle: Mutex<Option<LifecycleSink>>,
}

/// What the webview is told when it asks how the Harness is doing.
///
/// A plain `Option<HarnessEndpoint>` could not distinguish "the eager start
/// failed thirty seconds ago" from "nothing has tried to start yet", and the
/// eager start happens before any window exists, so a failure had nowhere to go
/// but `log::error!`. A log line is not a thing a user can be shown. This is.
///
/// `starting` is new because the spawn no longer holds the state lock while it
/// waits: a status call during the eager start now answers promptly instead of
/// blocking behind readiness, and what it answers is that a start is underway.
#[derive(Debug, Clone, Serialize)]
pub struct HarnessStatus {
    /// `running`, `starting`, `failed`, or `stopped`.
    pub state: &'static str,
    /// Present exactly when `state` is `running`. The view, not the endpoint:
    /// this crosses to the webview and the bearer does not.
    pub endpoint: Option<HarnessEndpointView>,
    /// Present exactly when `state` is `failed`. Already redacted -- every
    /// error the supervisor produces goes through `redact` first.
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct HarnessSupervisor {
    shared: Arc<Shared>,
}

impl std::fmt::Debug for HarnessSupervisor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HarnessSupervisor").finish_non_exhaustive()
    }
}

impl Default for HarnessSupervisor {
    fn default() -> Self {
        Self {
            shared: Arc::new(Shared::default()),
        }
    }
}

impl HarnessSupervisor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Installs the lifecycle sink. `lib.rs` passes the Tauri emitter; tests
    /// pass a recorder. Events emitted with no sink installed go nowhere,
    /// which is correct before any webview exists to hear them.
    pub(crate) fn set_lifecycle_sink(&self, sink: LifecycleSink) {
        *self.shared.lifecycle.lock().unwrap() = Some(sink);
    }

    /// Wires lifecycle events to the webview. Called once, from setup, once
    /// the application handle exists; the eager start usually began earlier
    /// and its `starting` went unheard, which costs nothing -- the webview's
    /// first look is a `status()` call, not an event backlog.
    pub(crate) fn attach_lifecycle_emitter(&self, app: AppHandle) {
        self.set_lifecycle_sink(Box::new(move |event| {
            if let Err(error) = app.emit(event.name(), event) {
                log::debug!("harness event {} undelivered: {error}", event.name());
            }
        }));
    }

    /// Emits through the sink, if anyone installed one. Never takes the state
    /// lock, and no sink takes it either, so emitting from inside a locked
    /// region cannot deadlock -- though callers still emit after unlocking,
    /// because a callback that observes half-finished bookkeeping is a bug
    /// waiting for a second subscriber.
    fn emit(&self, event: LifecycleEvent) {
        let sink = self.shared.lifecycle.lock().unwrap();
        if let Some(sink) = sink.as_ref() {
            sink(&event);
        }
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
        self.observe();
        let guard = self.shared.state.lock().unwrap();
        guard.running.as_ref().map(|r| r.endpoint.clone())
    }

    pub fn start(&self) -> Result<HarnessEndpoint, String> {
        self.spawn_installed(false)
    }

    /// Reaps a dead child and reacts to what its death was.
    ///
    /// Nobody watches the child between calls, so death is *observed* through
    /// the read paths -- every `get_endpoint`, `status`, and `start` looks
    /// first. Observation is where the consequences happen: the failure is
    /// recorded for `status`, the webview is told, and, once per
    /// [`RESTART_WINDOW`], the replacement begins.
    fn observe(&self) {
        let crash = {
            let mut guard = self.shared.state.lock().unwrap();
            Self::reap_locked(&mut guard)
        };
        let Some(crash) = crash else {
            return;
        };

        self.emit(LifecycleEvent::Failed(crash));

        let eligible = {
            let mut guard = self.shared.state.lock().unwrap();
            let eligible = guard
                .last_unexpected_exit
                .map_or(true, |at| at.elapsed() >= RESTART_WINDOW);
            guard.last_unexpected_exit = Some(Instant::now());
            eligible
        };
        if !eligible {
            // Already reported `failed`; the second chance is spent, and a
            // person decides what happens next.
            return;
        }

        // No `restarting` here: the announcement belongs to the spawn itself,
        // so there is exactly one per replacement even when several observers
        // trip over the same crash.
        let supervisor = self.clone();
        std::thread::spawn(move || {
            if let Err(error) = supervisor.spawn_installed(true) {
                log::error!("Harness supervisor: automatic restart failed: {error}");
            }
        });
    }

    /// Starts the Harness, single-flight.
    ///
    /// The previous version held the supervisor lock through spawn plus
    /// readiness -- up to [`STARTUP_TIMEOUT`] -- so a status call during the
    /// eager start blocked on that lock for the whole startup window. The lock
    /// is now taken for bookkeeping only: `starting` marks the flight, the
    /// long work runs without it, and a concurrent caller waits on the condvar
    /// to inherit the outcome rather than spawning a second Harness.
    ///
    /// The spawn path is synchronous, so nothing here holds a lock across an
    /// await; the discipline is the same one Clippy demanded of the async
    /// version, applied to reads as well.
    fn spawn_installed(&self, restarted: bool) -> Result<HarnessEndpoint, String> {
        let mut guard = self.shared.state.lock().unwrap();
        loop {
            // Hygiene, not reaction: if the previous child died while nobody
            // looked, move it out so a dead endpoint is never returned here.
            // The announcement of that death belongs to `observe`, which owns
            // the restart policy; this path *is* a replacement beginning.
            let _ = Self::reap_locked(&mut guard);

            if let Some(running) = &guard.running {
                return Ok(running.endpoint.clone());
            }

            if !guard.starting {
                guard.starting = true;
                // A child that does not exist yet owes no exit: whatever a
                // previous stop expected applies to the child it named, and a
                // stale flag here would teach this spawn's crash to masquerade
                // as a deliberate stop.
                guard.expected_exit = false;
                drop(guard);

                self.emit(if restarted {
                    LifecycleEvent::Restarting
                } else {
                    LifecycleEvent::Starting
                });

                let outcome = self.spawn();

                let mut guard = self.shared.state.lock().unwrap();
                guard.starting = false;
                self.shared.spawn_settled.notify_all();

                if guard.abort_start {
                    // A shutdown arrived while this spawn was in flight; the
                    // child is already dead (`spawn` polls the flag). Nothing
                    // installs, and no failure is recorded: the app is on its
                    // way out, and "failed" would be a lie a reopening window
                    // would show.
                    guard.abort_start = false;
                    guard.last_error = None;
                    return Err("harness start aborted by shutdown".to_string());
                }

                let result = Self::record_install(&mut guard, outcome);
                drop(guard);

                match &result {
                    Ok(endpoint) => self.emit(LifecycleEvent::Started(
                        HarnessEndpointView::from(endpoint.clone()),
                    )),
                    Err(error) => self.emit(LifecycleEvent::Failed(error.clone())),
                }
                return result;
            }

            // Another caller's spawn is in flight. Wait to inherit its result;
            // the spawn path always settles -- every stage inside it is bounded
            // -- so a timeout here means something is wedged beyond all of its
            // own bounds, which is worth reporting rather than out-staring.
            let (next, settled) = self
                .shared
                .spawn_settled
                .wait_timeout(guard, STARTUP_TIMEOUT + DRAIN_BOUND)
                .unwrap();
            if settled.timed_out() {
                return Err("a harness start is in flight and did not settle".to_string());
            }
            guard = next;
        }
    }

    /// Installs a finished spawn, or records why there is nothing to install.
    ///
    /// A success clears the previous failure rather than leaving it beside a
    /// live endpoint, where the next reader would have to decide which of the
    /// two to believe.
    fn record_install(
        guard: &mut Inner,
        outcome: Result<(Child, HarnessEndpoint), String>,
    ) -> Result<HarnessEndpoint, String> {
        match outcome {
            Ok((child, endpoint)) => {
                guard.running = Some(RunningHarness {
                    child,
                    endpoint: endpoint.clone(),
                });
                guard.start_count += 1;
                guard.last_endpoint = Some(endpoint.clone());
                guard.last_error = None;
                Ok(endpoint)
            }
            Err(error) => {
                // Kept, not just returned. `run()` starts the Harness on a
                // background thread before any window exists, so the caller
                // that sees this error may be a thread with nobody to tell;
                // `status` is how the webview learns about it afterwards.
                guard.last_error = Some(error.clone());
                Err(error)
            }
        }
    }

    /// The state a UI can render, including a start that failed with no window
    /// yet open to receive the error, and one that has not finished yet.
    ///
    /// Prompt by construction: `get_endpoint` and the lock below are both held
    /// for microseconds of bookkeeping, never across the spawn, so a status
    /// call during a start answers `starting` instead of queueing behind it.
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

        let guard = self.shared.state.lock().unwrap();
        if guard.starting {
            return HarnessStatus {
                state: "starting",
                endpoint: None,
                error: None,
            };
        }
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

    /// Stops the current Harness politely and starts a fresh one.
    ///
    /// Deliberately routed through the same graceful stop as quitting: a
    /// manual restart that hard-killed would leave exactly the hot WAL this
    /// whole task exists to stop leaving.
    pub fn restart(&self) -> Result<HarnessEndpoint, String> {
        let old = {
            let mut guard = self.shared.state.lock().unwrap();
            let old = guard.running.take();
            if old.is_some() {
                guard.expected_exit = true;
            }
            old
        };
        if let Some(mut running) = old {
            log::info!(
                "Harness supervisor: stopping harness pid={} for restart",
                running.endpoint.pid
            );
            match Self::stop_politely(
                &mut running.child,
                &running.endpoint,
                SHUTDOWN_ACK_TIMEOUT,
                DRAIN_BOUND,
            ) {
                PoliteOutcome::Exited => {}
                PoliteOutcome::RequestFailed(reason) => log::warn!(
                    "Harness supervisor: the polite shutdown did not work ({reason}); terminated pid={}",
                    running.endpoint.pid
                ),
                PoliteOutcome::DrainExceeded => log::warn!(
                    "Harness supervisor: the polite shutdown did not work (did not exit within {}ms); terminated pid={}",
                    DRAIN_BOUND.as_millis(),
                    running.endpoint.pid
                ),
            }
            // Unconditional sweep, polite path included: the group should be
            // empty, and on Unix a descendant that outlived its parent is what
            // the group address is for.
            Self::terminate_child(&mut running.child);

            let mut guard = self.shared.state.lock().unwrap();
            guard.last_endpoint = Some(running.endpoint);
            guard.last_error = None;
            guard.expected_exit = false;
        }

        let endpoint = self.spawn_installed(true)?;
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

    /// Spawns the child and waits for readiness, holding no lock across the
    /// wait. Returns the child so the caller can install it atomically with
    /// its endpoint under the lock.
    fn spawn(&self) -> Result<(Child, HarnessEndpoint), String> {
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

        let (mut child, readiness_stream) = self.launch(server_path, bootstrap)?;

        // Checked throughout the readiness wait, every 50ms tick: a shutdown
        // that arrives mid-spawn lands this child dead instead of installed.
        let abort = {
            let shared = self.shared.clone();
            move || {
                shared
                    .state
                    .lock()
                    .map(|guard| guard.abort_start)
                    .unwrap_or(false)
            }
        };

        let readiness = match Self::wait_for_readiness(readiness_stream, &mut child, &token, &abort)
        {
            Ok(readiness) => readiness,
            Err(error) => {
                Self::terminate_child(&mut child);
                return Err(error);
            }
        };

        // Verify endpoint host is loopback
        if readiness.host != "127.0.0.1" {
            Self::terminate_child(&mut child);
            return Err(format!(
                "harness readiness host must be 127.0.0.1, got {}",
                readiness.host
            ));
        }

        let endpoint = match HarnessEndpoint::from_readiness(readiness, token.clone()) {
            Some(endpoint) => endpoint,
            None => {
                Self::terminate_child(&mut child);
                return Err("invalid readiness frame".to_string());
            }
        };

        // Startup is over, so nothing is reading the child's pipes any more.
        // From here they are drained for their whole life, not sampled on
        // failure.
        Self::drain_output(&mut child);

        // Do not log token
        log::info!(
            "Harness supervisor: harness ready pid={} {}:{} session={} (token redacted)",
            endpoint.pid,
            endpoint.host,
            endpoint.port,
            endpoint.session_id
        );

        Ok((child, endpoint))
    }

    /// Creates the Node child: environment policy, descriptors, containment.
    ///
    /// Split out of the old monolithic `spawn_child` so the readiness wait --
    /// the only slow part -- can run without the supervisor lock. The one step
    /// that needs it is the Windows job assignment, and that is a few
    /// syscalls; it is also the only reason this is a method rather than a
    /// free function.
    fn launch(
        &self,
        server_path: PathBuf,
        bootstrap: AdmissionBootstrap,
    ) -> Result<(Child, ReadinessStream), String> {
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

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "failed to spawn node harness: {e} (path={})",
                server_path.display()
            )
        })?;

        // The other half of the containment above, for the platform that can
        // only do it once the process exists. Fatal rather than logged: a
        // Harness outside the job is one whose MCP children can outlive it,
        // which is the condition this exists to prevent.
        //
        // Under the bookkeeping lock for the instant of the assignment. The
        // lock is released before any slow step, so this cannot contend with
        // a status call for longer than a few syscalls.
        if let Err(error) = {
            let mut guard = self.shared.state.lock().unwrap();
            guard.containment.contain(&child)
        } {
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

        Ok((child, readiness_stream))
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
        abort: &dyn Fn() -> bool,
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
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // The abort check lives in the polling tick because this is
                    // the only loop a spawn spends real time inside; a shutdown
                    // that arrives mid-spawn therefore lands within one tick.
                    if abort() {
                        Self::terminate_child(child);
                        return Err("harness start aborted by shutdown".to_string());
                    }
                    continue;
                }
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

    /// Moves out a child found dead, recording what its exit meant.
    ///
    /// Returns the sentence when the exit was unexpected: nobody asked for it,
    /// so it is a crash, and `status` must be able to say so rather than
    /// reporting `stopped` with nothing. An exit under `expected_exit` is a
    /// stop landing -- the flag is consumed with the child so it cannot leak
    /// into the next lifecycle.
    fn reap_locked(guard: &mut Inner) -> Option<String> {
        let status = guard
            .running
            .as_mut()
            .and_then(|running| running.child.try_wait().ok().flatten())?;
        let mut running = guard.running.take().expect("the status came from running");

        let sentence = redact(
            &format!("Harness exited unexpectedly: {status}"),
            &running.endpoint.token,
        );
        // The root is gone, but descendants may not be; the sweep is the same
        // one a deliberate stop gets.
        Self::terminate_child(&mut running.child);

        let deliberate = guard.expected_exit;
        guard.expected_exit = false;
        guard.last_endpoint = Some(running.endpoint);
        if deliberate {
            // The stop that was asked for. A failure sentence here would be a
            // lie told to whoever opens the app next.
            guard.last_error = None;
            None
        } else {
            guard.last_error = Some(sentence.clone());
            Some(sentence)
        }
    }

    /// Stops the Harness, politely first.
    ///
    /// Every quit used to run the crash path: `terminate_child` on Windows is
    /// `TerminateProcess`, no handler runs, the databases are never closed,
    /// and a hot `-wal` sat beside `studio.db` after every stop. The Harness
    /// answers `POST /api/shutdown` by invalidating admission, draining its
    /// MCP servers, and closing both databases; this waits for that with a
    /// bounded patience ([`DRAIN_BOUND`]) and falls back to termination past
    /// it, loudly -- a silent fallback means the mechanism broke and nobody
    /// learned.
    pub fn shutdown_all(&self) {
        // Poison-tolerant, and only here: this runs on the exit path, where
        // the alternative to recovering is a process that cannot stop its own
        // child because some other thread died mid-bookkeeping. A half-updated
        // Inner costs at most a mislabelled event during quit; an aborted
        // cleanup leaks a Harness holding a port.
        //
        // Stop admitting first: taking the child out means `get_endpoint`
        // answers None and the service seam refuses new work before the ask
        // goes out. An in-flight spawn is told to land dead.
        let (running, was_starting) = {
            let mut guard = self
                .shared
                .state
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            let was_starting = guard.starting;
            if was_starting {
                guard.abort_start = true;
            }
            if guard.running.is_some() {
                guard.expected_exit = true;
            }
            (guard.running.take(), was_starting)
        };

        // Wait for the in-flight spawn to settle so a quit cannot race a
        // Harness into existence behind the app's back. Bounded: past the
        // bound the process containment -- job object or process group -- is
        // the backstop, which is what it exists for.
        if was_starting {
            let guard = self
                .shared
                .state
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            let (guard, settled) = self
                .shared
                .spawn_settled
                .wait_timeout(guard, DRAIN_BOUND)
                .unwrap_or_else(|p| p.into_inner());
            drop(guard);
            if settled.timed_out() {
                log::warn!(
                    "Harness supervisor: an in-flight start did not settle within {}ms of a shutdown; relying on process containment",
                    DRAIN_BOUND.as_millis()
                );
            }
        }

        let Some(mut running) = running else {
            return;
        };

        log::info!(
            "Harness supervisor: shutting down harness pid={}",
            running.endpoint.pid
        );
        match Self::stop_politely(
            &mut running.child,
            &running.endpoint,
            SHUTDOWN_ACK_TIMEOUT,
            DRAIN_BOUND,
        ) {
            PoliteOutcome::Exited => {}
            PoliteOutcome::RequestFailed(reason) => log::warn!(
                "Harness supervisor: the polite shutdown did not work ({reason}); terminated pid={}",
                running.endpoint.pid
            ),
            PoliteOutcome::DrainExceeded => log::warn!(
                "Harness supervisor: the polite shutdown did not work (did not exit within {}ms); terminated pid={}",
                DRAIN_BOUND.as_millis(),
                running.endpoint.pid
            ),
        }
        // Unconditional sweep, polite path included: the Harness stops its own
        // MCP servers before exiting, so the group should be empty -- but the
        // cost of checking twice is zero and the cost of an orphan is a port.
        Self::terminate_child(&mut running.child);

        {
            let mut guard = self
                .shared
                .state
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            guard.last_endpoint = Some(running.endpoint);
            guard.last_error = None;
            guard.expected_exit = false;
        }
        self.emit(LifecycleEvent::Stopped);
    }

    /// Asks the child to stop itself, then watches it with a bounded patience.
    ///
    /// Never terminates: deciding to fall back is the caller's, so the warning
    /// log and the kill come from the same place and cannot drift apart.
    ///
    /// The request is a hand-written loopback POST rather than the service
    /// seam's client: `shutdown_all` runs synchronously on the exit path,
    /// where no async runtime is guaranteed to still exist, and this crate
    /// already speaks bare HTTP/1.1 to this exact peer in `integration.rs`.
    /// The bearer is attached here, in Rust, and reaches no log.
    fn stop_politely(
        child: &mut Child,
        endpoint: &HarnessEndpoint,
        ack_timeout: Duration,
        drain_bound: Duration,
    ) -> PoliteOutcome {
        match Self::post_shutdown(endpoint, ack_timeout) {
            Ok(code) if (200..300).contains(&code) => {}
            Ok(code) => {
                return PoliteOutcome::RequestFailed(format!(
                    "the harness refused the shutdown request with status {code}"
                ))
            }
            Err(reason) => return PoliteOutcome::RequestFailed(reason),
        }

        let start = Instant::now();
        while start.elapsed() < drain_bound {
            match child.try_wait() {
                Ok(Some(_)) => return PoliteOutcome::Exited,
                Ok(None) => std::thread::sleep(Duration::from_millis(25)),
                Err(error) => {
                    return PoliteOutcome::RequestFailed(format!("failed to poll child: {error}"))
                }
            }
        }
        PoliteOutcome::DrainExceeded
    }

    /// `POST /api/shutdown` with the per-launch bearer. Reads headers only:
    /// the acknowledgment arrives before the drain, and waiting for EOF would
    /// wait for the process to die -- turning the ack timeout into a second,
    /// shorter drain bound with less honesty about which phase stalled.
    fn post_shutdown(endpoint: &HarnessEndpoint, timeout: Duration) -> Result<u16, String> {
        let address = format!("{}:{}", endpoint.host, endpoint.port)
            .to_socket_addrs()
            .map_err(|e| redact(&format!("could not resolve the harness address: {e}"), &endpoint.token))?
            .next()
            .ok_or_else(|| "the harness address resolved to nothing".to_string())?;

        let mut stream = TcpStream::connect_timeout(&address, timeout).map_err(|e| {
            redact(
                &format!("could not reach the harness to ask it to stop: {e}"),
                &endpoint.token,
            )
        })?;
        stream.set_read_timeout(Some(timeout)).map_err(|e| e.to_string())?;
        stream.set_write_timeout(Some(timeout)).map_err(|e| e.to_string())?;

        let request = format!(
            "POST /api/shutdown HTTP/1.1\r\nHost: {}:{}\r\nAuthorization: Bearer {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            endpoint.host, endpoint.port, endpoint.token
        );
        stream.write_all(request.as_bytes()).map_err(|e| {
            redact(&format!("the shutdown request could not be written: {e}"), &endpoint.token)
        })?;
        stream.flush().map_err(|e| e.to_string())?;

        let mut raw = Vec::new();
        let mut chunk = [0u8; 512];
        while !raw.windows(4).any(|window| window == b"\r\n\r\n") && raw.len() < 8192 {
            let read = stream.read(&mut chunk).map_err(|e| {
                redact(
                    &format!("the harness did not acknowledge the shutdown request: {e}"),
                    &endpoint.token,
                )
            })?;
            if read == 0 {
                break;
            }
            raw.extend_from_slice(&chunk[..read]);
        }

        let response = String::from_utf8_lossy(&raw).into_owned();
        response
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse::<u16>().ok())
            .ok_or_else(|| {
                redact(
                    &format!("no status line in the shutdown response: {response}"),
                    &endpoint.token,
                )
            })
    }
}

/// What came of asking the Harness to stop itself.
#[derive(Debug)]
enum PoliteOutcome {
    /// It acknowledged and exited within the drain bound.
    Exited,
    /// The request itself failed: refused, unreachable, or unanswered.
    RequestFailed(String),
    /// It acknowledged but outlived the drain bound.
    DrainExceeded,
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::harness::test_support::{ONE_HARNESS_AT_A_TIME, StopOnDrop};

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

    /// Events as `name payload-json` strings, for asserting order and for
    /// proving the bearer rides none of them.
    fn recording_events() -> (Arc<Mutex<Vec<String>>>, LifecycleSink) {
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink: LifecycleSink = {
            let seen = seen.clone();
            Box::new(move |event: &LifecycleEvent| {
                let payload = serde_json::to_string(event).expect("an event serialises");
                seen.lock().unwrap().push(format!("{} {payload}", event.name()));
            })
        };
        (seen, sink)
    }

    /// Where the Harness keeps `studio.db` when nothing overrides the home --
    /// which is every launch this crate makes, because the environment
    /// allowlist deliberately does not pass `PROJECT_STUDIO_HOME`.
    fn studio_wal_path() -> PathBuf {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .expect("a home directory");
        PathBuf::from(home)
            .join(".studio")
            .join("data")
            .join("studio.db-wal")
    }

    /// The old shutdown, kept as the contrast case: `TerminateProcess` on
    /// Windows, SIGKILL on Unix -- no handler runs, nothing is checkpointed.
    fn hard_kill(pid: u32) {
        #[cfg(windows)]
        {
            let output = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .output()
                .expect("run taskkill");
            assert!(
                output.status.success(),
                "taskkill failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        #[cfg(unix)]
        {
            nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGKILL,
            )
            .expect("kill -9 the harness");
        }
    }

    /// Polls until `probe` holds or the deadline passes. Used only where the
    /// awaited condition is a real asynchronous event (a crash being observed,
    /// a replacement coming up), never to paper over a deterministic answer.
    fn eventually(deadline: Duration, mut probe: impl FnMut() -> bool) -> bool {
        let start = Instant::now();
        while start.elapsed() < deadline {
            if probe() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        false
    }

    /// One-shot stub HTTP server answering `code` to the shutdown POST.
    ///
    /// `hold` keeps the connection open afterwards, standing in for a harness
    /// that acknowledged but never exits; the real one closes the connection
    /// by dying.
    fn stub_shutdown_endpoint(code: u16, hold: bool) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a stub listener");
        let port = listener.local_addr().expect("a local address").port();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept one connection");
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 512];
            while !buffer.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = socket.read(&mut chunk).expect("read the request");
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..read]);
            }
            let response =
                format!("HTTP/1.1 {code} Stub\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            socket.write_all(response.as_bytes()).expect("write the response");
            socket.flush().expect("flush the response");
            if hold {
                std::thread::sleep(Duration::from_secs(5));
            }
        });
        port
    }

    /// A child that stays alive until killed, standing in for a harness whose
    /// polite request did not land.
    fn stubborn_child() -> Child {
        let mut cmd = stubborn_command();
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
        cmd.spawn().expect("spawn a stand-in child")
    }

    #[cfg(windows)]
    fn stubborn_command() -> Command {
        let mut cmd = Command::new("cmd");
        cmd.args(["/c", "ping -n 30 127.0.0.1 >NUL"]);
        cmd
    }

    #[cfg(unix)]
    fn stubborn_command() -> Command {
        let mut cmd = Command::new("sleep");
        cmd.arg("30");
        cmd
    }

    fn fabricated_endpoint(port: u16) -> HarnessEndpoint {
        HarnessEndpoint {
            host: "127.0.0.1".to_string(),
            port,
            pid: 4242,
            url: format!("http://127.0.0.1:{port}"),
            client_id: "studio-host".to_string(),
            session_id: "test-session".to_string(),
            token: "stub-bearer-value".to_string(),
        }
    }

    /// The observable proof of the graceful stop: a clean close checkpoints
    /// and removes the WAL, so nothing hot is left beside `studio.db`. The
    /// file existing *while the harness runs* is what makes the final
    /// assertion mean something rather than trivially holding.
    #[test]
    fn a_deliberate_stop_reports_stopped_and_leaves_no_hot_wal() {
        let _serial = ONE_HARNESS_AT_A_TIME.blocking_lock();
        let supervisor = HarnessSupervisor::new();
        let (events, sink) = recording_events();
        supervisor.set_lifecycle_sink(sink);

        let endpoint = supervisor.start().expect("the harness must start");
        let _stop = StopOnDrop(supervisor.clone());

        assert_eq!(supervisor.status().state, "running");

        let wal = studio_wal_path();
        assert!(
            wal.exists(),
            "the WAL sits beside studio.db while the harness runs: {}",
            wal.display()
        );

        supervisor.shutdown_all();

        assert_eq!(supervisor.status().state, "stopped");
        assert!(supervisor.get_endpoint().is_none());
        assert!(
            !wal.exists(),
            "a polite stop leaves no hot WAL beside studio.db: {}",
            wal.display()
        );

        let recorded = events.lock().unwrap().clone();
        assert!(
            recorded.iter().any(|e| e.starts_with("harness-started")),
            "the start was not announced: {recorded:?}"
        );
        assert!(
            recorded.iter().any(|e| e.starts_with("harness-stopped")),
            "the stop was not announced: {recorded:?}"
        );
        assert!(
            !recorded.iter().any(|e| e.contains(&endpoint.token)),
            "the bearer must not ride an event: {recorded:?}"
        );
    }

    /// A crash nobody asked for reports `failed` with a reason, tells the
    /// webview, and brings the harness back exactly once. The WAL assertion
    /// before any observation is the contrast case for the polite stop: this
    /// is what every quit left behind before the shutdown route existed,
    /// produced here by the same mechanism (`TerminateProcess`) it used.
    #[test]
    fn an_unexpected_exit_reports_failed_and_restarts_once() {
        let _serial = ONE_HARNESS_AT_A_TIME.blocking_lock();
        let supervisor = HarnessSupervisor::new();
        let (events, sink) = recording_events();
        supervisor.set_lifecycle_sink(sink);

        let endpoint = supervisor.start().expect("the harness must start");
        let _stop = StopOnDrop(supervisor.clone());

        hard_kill(endpoint.pid);

        // Nothing has looked yet, so nothing has reacted: the WAL is still
        // hot, and no restart has been scheduled.
        let wal = studio_wal_path();
        assert!(wal.exists(), "a hard kill leaves the WAL un-checkpointed");

        assert!(
            eventually(Duration::from_secs(10), || supervisor.status().state != "running"),
            "the crash must surface through the read paths"
        );
        assert!(
            eventually(
                STARTUP_TIMEOUT + Duration::from_secs(10),
                || supervisor.status().state == "running"
            ),
            "one unexpected exit must restart automatically"
        );
        assert_eq!(
            supervisor.shared.state.lock().unwrap().start_count,
            2,
            "the replacement is the second start"
        );

        let recorded = events.lock().unwrap().clone();
        let failed = recorded
            .iter()
            .position(|e| e.starts_with("harness-failed"))
            .expect("the crash was announced");
        assert!(
            recorded[failed].contains("unexpectedly"),
            "the failure must say why: {}",
            recorded[failed]
        );
        let restarting = recorded
            .iter()
            .position(|e| e.starts_with("harness-restarting"))
            .expect("the restart was announced");
        assert!(failed < restarting, "failure precedes the restart: {recorded:?}");
        assert!(
            !recorded.iter().any(|e| e.contains(&endpoint.token)),
            "the bearer must not ride an event: {recorded:?}"
        );
    }

    /// The second crash inside the window gets neither a third harness nor an
    /// endless spinner: terminal `failed`, and the count proves nothing is
    /// quietly starting behind it. Restart loops look like activity while
    /// fixing nothing; this is the anti-loop.
    #[test]
    fn a_second_crash_inside_the_window_does_not_restart() {
        let _serial = ONE_HARNESS_AT_A_TIME.blocking_lock();
        let supervisor = HarnessSupervisor::new();
        let (events, sink) = recording_events();
        supervisor.set_lifecycle_sink(sink);

        let first = supervisor.start().expect("the harness must start");
        let _stop = StopOnDrop(supervisor.clone());

        hard_kill(first.pid);

        // Wait for the death to be *observed* before waiting for the
        // replacement. The first poll can outrun the kill becoming visible to
        // `try_wait` -- "running" then describes a corpse, and a test that
        // waited for `== "running"` would pass without any restart at all.
        assert!(
            eventually(Duration::from_secs(10), || supervisor.status().state != "running"),
            "the first crash must surface"
        );
        assert!(
            eventually(
                STARTUP_TIMEOUT + Duration::from_secs(10),
                || supervisor.status().state == "running"
            ),
            "the first crash must restart"
        );
        assert_eq!(supervisor.shared.state.lock().unwrap().start_count, 2);
        let second = supervisor
            .get_endpoint()
            .expect("the restarted harness publishes an endpoint");
        assert_ne!(second.pid, first.pid, "a different process came up");

        hard_kill(second.pid);
        assert!(
            eventually(Duration::from_secs(10), || supervisor.status().state == "failed"),
            "the second crash must report failed with a message"
        );
        let error = supervisor.status().error.expect("a failure sentence");
        assert!(error.contains("unexpectedly"), "{error}");

        // Long enough that a wrongly-scheduled restart would have flipped the
        // count or the state; neither may move.
        std::thread::sleep(Duration::from_secs(3));
        assert_eq!(
            supervisor.shared.state.lock().unwrap().start_count,
            2,
            "no third start may follow a second crash inside the window"
        );
        assert_eq!(supervisor.status().state, "failed");

        let recorded = events.lock().unwrap().clone();
        assert_eq!(
            recorded
                .iter()
                .filter(|e| e.starts_with("harness-restarting"))
                .count(),
            1,
            "exactly one restart was offered: {recorded:?}"
        );
    }

    /// The read path must answer during a spawn, not queue behind it. The
    /// poller starts first and samples faster than the spawn can possibly
    /// progress, so `starting` -- a state that lasts for a whole Node boot --
    /// cannot be missed; this is sampling a wide window, not racing one.
    #[test]
    fn status_answers_starting_while_a_spawn_is_in_flight() {
        let _serial = ONE_HARNESS_AT_A_TIME.blocking_lock();
        let supervisor = HarnessSupervisor::new();
        let _stop = StopOnDrop(supervisor.clone());

        let seen: Arc<Mutex<Vec<&'static str>>> = Arc::new(Mutex::new(Vec::new()));
        let poller = {
            let seen = seen.clone();
            let supervisor = supervisor.clone();
            std::thread::spawn(move || loop {
                let state = supervisor.status().state;
                seen.lock().unwrap().push(state);
                if state == "running" || state == "failed" {
                    break;
                }
                std::thread::sleep(Duration::from_millis(2));
            })
        };

        // Ahead of the start, so the states recorded are the ones it passes
        // through rather than the ones it left behind.
        std::thread::sleep(Duration::from_millis(20));
        supervisor.start().expect("the harness must start");
        poller.join().expect("the poller must finish");

        let observed = seen.lock().unwrap().clone();
        assert!(
            observed.contains(&"starting"),
            "a spawn in flight must read as starting, got: {observed:?}"
        );
        assert_eq!(observed.last().copied(), Some("running"));
    }

    /// A refusal must not silently become success: the outcome says the
    /// request failed, which is what makes the caller log the fallback before
    /// terminating. Without this, a broken shutdown route would degrade into
    /// the old hard kill with nobody the wiser.
    #[test]
    fn a_refused_polite_request_reports_failure_for_the_fallback() {
        let port = stub_shutdown_endpoint(403, false);
        let mut child = stubborn_child();

        let outcome = HarnessSupervisor::stop_politely(
            &mut child,
            &fabricated_endpoint(port),
            SHUTDOWN_ACK_TIMEOUT,
            Duration::from_millis(300),
        );

        assert!(
            matches!(outcome, PoliteOutcome::RequestFailed(_)),
            "{outcome:?}"
        );
        HarnessSupervisor::terminate_child(&mut child);
        assert!(child.try_wait().expect("poll the child").is_some());
    }

    /// Acknowledged-but-alive-past-the-bound is the other way the polite path
    /// can fail, and it must be distinguishable from success for the same
    /// reason: the fallback log is how a stuck drain is ever noticed.
    #[test]
    fn an_acknowledged_harness_that_outlives_the_drain_bound_reports_it() {
        let port = stub_shutdown_endpoint(202, true);
        let mut child = stubborn_child();

        let outcome = HarnessSupervisor::stop_politely(
            &mut child,
            &fabricated_endpoint(port),
            SHUTDOWN_ACK_TIMEOUT,
            Duration::from_millis(300),
        );

        assert!(matches!(outcome, PoliteOutcome::DrainExceeded), "{outcome:?}");
        HarnessSupervisor::terminate_child(&mut child);
        assert!(child.try_wait().expect("poll the child").is_some());
    }
}
