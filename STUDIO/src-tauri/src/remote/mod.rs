//! "Open on other devices": the listener that lets a browser be Studio.
//!
//! A phone, a laptop or a tablet opens an address and gets the same Studio the
//! desktop window shows — the same conversations, the same running turn, the
//! same permission prompts. Not a second copy of the work and not a cut-down
//! view: another render of one state that lives in the harness (ADR 0050).
//!
//! ---- Why the listener is here and not in the harness --------------------
//!
//! The obvious alternative was to have the harness bind a second, network
//! facing port and serve the UI itself. It was rejected, and the reasons are
//! worth keeping next to the code:
//!
//! - **ADR 0028's rule survives untouched.** The harness binds `127.0.0.1`,
//!   the supervisor refuses any readiness frame naming a host that is not
//!   loopback, and neither statement has to grow an "unless remote access is
//!   on" clause. A rule with no exceptions is worth more than a convenient
//!   one.
//! - **The per-launch bearer never leaves Rust** (ADR 0044). A device is
//!   never given it and never will be; this process attaches it on the way to
//!   loopback, exactly as `service_fetch` does for the webview.
//! - **Both halves already existed.** The frontend is embedded in this binary
//!   for the desktop window, and the frontend has always been an ordinary
//!   HTTP client that names relative paths. What was missing was a server for
//!   it to talk to.
//!
//! The cost, stated plainly rather than apologised for: remote access works
//! only while Studio is running on the PC. The feature exists to check on work
//! you left running there, so that is the correct behaviour.
//!
//! ---- What this step does and does not do -------------------------------
//!
//! This is step 1 of the plan. The listener binds **loopback only**. There is
//! no pairing yet, and until there is, binding to the network would put an
//! unauthenticated Studio on the home network — so the address it binds is not
//! configurable to anything else. The network bind arrives in the same change
//! as the pairing that guards it, deliberately, so that neither can be shipped
//! without the other.

mod assets;
mod body;
mod proxy;

use std::convert::Infallible;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Mutex;

use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tauri::{AppHandle, Runtime};
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::harness::supervisor::HarnessSupervisor;

use body::RemoteBody;
use proxy::Upstream;

/// The port the listener prefers.
///
/// Fixed rather than "whatever is free", because the address is something a
/// person reads off a screen and types on a phone, and an address that changes
/// between launches is one nobody can remember or bookmark. When it is taken,
/// the answer is to say so plainly and let the person choose another - not to
/// drift silently to a different number and leave a stale bookmark pointing at
/// whatever else is now on the old one.
///
/// Why this number, since the obvious instinct is that a stranger one is
/// safer:
///
/// - **It is below 49152**, which is where Windows' dynamic range begins.
///   A fixed port above that line competes with every outgoing connection the
///   machine makes for a port, so it would bind almost always and fail
///   occasionally - the worst shape a bug can have. "Weirder" upward is
///   therefore worse, not better.
/// - **It is clear of the bands things actually sit in**: the dev-tool crowd
///   at 3000, 5173, 8000, 8080 and 8888; the VNC range at 5900-5999; the game
///   servers at 7777; Windows' own Delivery Optimization at 7680.
/// - **It reads as nothing.** A port number is shown to people in settings and
///   printed in an address, so one that looks like a joke is a small cost paid
///   forever by software meant to feel ordinary.
pub(crate) const DEFAULT_PORT: u16 = 4747;

/// An override, for the case where the default is genuinely occupied.
const PORT_VARIABLE: &str = "PROJECT_STUDIO_REMOTE_PORT";

/// The listener as the rest of the app holds it.
///
/// One at a time: starting while one runs is answered with the address that is
/// already serving rather than by binding a second port, so a double click on
/// a switch cannot leave two listeners and one forgotten handle.
#[derive(Default)]
pub struct RemoteAccess {
    running: Mutex<Option<Running>>,
}

struct Running {
    address: SocketAddr,
    /// Dropping or setting this ends the accept loop. A `watch` rather than a
    /// `oneshot` because the loop selects on it repeatedly.
    stop: watch::Sender<bool>,
}

impl RemoteAccess {
    /// The address being served, if the listener is on.
    pub fn address(&self) -> Option<SocketAddr> {
        self.running
            .lock()
            .ok()
            .and_then(|running| running.as_ref().map(|running| running.address))
    }

    /// Starts the listener, or reports the one already running.
    ///
    /// The bind happens before anything is recorded, so a failure — the port
    /// taken, above all — leaves the state exactly as it was and can be shown
    /// to the person as the sentence it is.
    pub async fn start<R: Runtime>(
        &self,
        app: AppHandle<R>,
        supervisor: HarnessSupervisor,
    ) -> Result<SocketAddr, String> {
        if let Some(address) = self.address() {
            return Ok(address);
        }

        let port = configured_port();
        // Loopback, deliberately and not configurably. See the module note.
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let listener = TcpListener::bind(address).await.map_err(|error| {
            format!("Studio could not open port {port} for other devices: {error}")
        })?;
        let address = listener.local_addr().unwrap_or(address);

        let (stop, mut stopped) = watch::channel(false);

        {
            let mut running = self
                .running
                .lock()
                .map_err(|_| "Studio lost track of the listener.".to_owned())?;
            if let Some(existing) = running.as_ref() {
                // Someone else won the race between the check above and here.
                // Their listener is the real one; this one is dropped unbound.
                return Ok(existing.address);
            }
            *running = Some(Running { address, stop });
        }

        tauri::async_runtime::spawn(async move {
            loop {
                let accepted = tokio::select! {
                    _ = stopped.changed() => break,
                    accepted = listener.accept() => accepted,
                };
                let Ok((stream, _peer)) = accepted else {
                    // One failed accept is not a reason to stop serving; the
                    // listener is still bound and the next one may be fine.
                    continue;
                };
                // A conversation stream is written a chunk at a time and each
                // chunk has to leave immediately. Nagle's algorithm holds a
                // small write back waiting for company, which turns a live
                // turn into a stuttering one - so it is turned off here rather
                // than diagnosed later as "streaming feels laggy on the
                // phone". A failure to set it is not worth refusing the
                // connection over.
                let _ = stream.set_nodelay(true);
                let app = app.clone();
                let supervisor = supervisor.clone();
                tauri::async_runtime::spawn(async move {
                    let io = TokioIo::new(stream);
                    let service = service_fn(move |request| {
                        handle(app.clone(), supervisor.clone(), request)
                    });
                    if let Err(error) = http1::Builder::new().serve_connection(io, service).await
                    {
                        log::debug!("Remote access: connection ended: {error}");
                    }
                });
            }
            log::info!("Remote access: stopped serving {address}");
        });

        log::info!("Remote access: serving {address}");
        Ok(address)
    }

    /// Stops the listener and drops every connection. Idempotent.
    pub fn stop(&self) {
        let Ok(mut running) = self.running.lock() else {
            return;
        };
        if let Some(running) = running.take() {
            // The accept loop sees this and breaks, which drops the listener
            // and closes the port. Connections already open end with it.
            let _ = running.stop.send(true);
        }
    }
}

/// The port to bind: the fixed default, or the override when it is set to
/// something usable. A malformed or zero override is ignored rather than
/// obeyed, since binding port 0 would hand out an address nobody can predict.
fn configured_port() -> u16 {
    std::env::var(PORT_VARIABLE)
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .filter(|port| *port != 0)
        .unwrap_or(DEFAULT_PORT)
}

/// One request from a device: either the harness's, or the frontend's.
async fn handle<R: Runtime>(
    app: AppHandle<R>,
    supervisor: HarnessSupervisor,
    request: Request<hyper::body::Incoming>,
) -> Result<Response<RemoteBody>, Infallible> {
    let path = request.uri().path().to_owned();

    if proxy::is_harness_path(&path) {
        let Some(endpoint) = supervisor.get_endpoint() else {
            return Ok(proxy::refusal(
                StatusCode::SERVICE_UNAVAILABLE,
                "Studio's harness is not running.",
            ));
        };
        let upstream = Upstream {
            url: endpoint.url.clone(),
            token: endpoint.token.clone(),
        };
        return Ok(proxy::forward(&upstream, request).await);
    }

    Ok(assets::serve(&app, &path))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The variable is process-wide, so the two cases that read it share one
    /// test rather than racing each other from separate ones.
    #[test]
    fn the_port_is_the_default_unless_a_usable_override_says_otherwise() {
        // SAFETY: single-threaded within this test, and the variable is
        // removed again before it returns.
        unsafe { std::env::remove_var(PORT_VARIABLE) };
        assert_eq!(configured_port(), DEFAULT_PORT);

        unsafe { std::env::set_var(PORT_VARIABLE, "9123") };
        assert_eq!(configured_port(), 9123);

        // Port 0 means "any free port" to the OS, which would produce an
        // address nobody could have been told in advance.
        unsafe { std::env::set_var(PORT_VARIABLE, "0") };
        assert_eq!(configured_port(), DEFAULT_PORT);

        unsafe { std::env::set_var(PORT_VARIABLE, "not a port") };
        assert_eq!(configured_port(), DEFAULT_PORT);

        unsafe { std::env::remove_var(PORT_VARIABLE) };
    }

    #[test]
    fn a_listener_that_was_never_started_has_no_address() {
        let remote = RemoteAccess::default();
        assert!(remote.address().is_none());
        // Stopping one that never ran is not an error.
        remote.stop();
        assert!(remote.address().is_none());
    }
}
