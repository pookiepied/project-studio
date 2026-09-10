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
//! ---- The bind and its guard arrive together ----------------------------
//!
//! The listener binds the machine's interfaces, not loopback: that is the
//! point of the feature. It may do so only because every path that reaches
//! the harness now carries the pairing gate (`gate.rs`), and the bind and the
//! gate are deliberately in the same change — there is no build in which the
//! machine is reachable without a paired device being the only way in. An
//! unpaired device gets the frontend shell, whose pairing screen is part of
//! the shell, and nothing else: every harness path refuses it.
//!
//! Two consequences are stated rather than left implied. First, the credential
//! store must be usable: pairing cannot work without it, so `start` refuses
//! to serve on a machine where it cannot, rather than binding a listener that
//! is either useless or tempting to weaken. Second, revocation is immediate:
//! removing a device fires a signal that ends its open connections — a stream
//! mid-read included — so the next thing that device does is fail, not the
//! next thing after that.

mod assets;
mod body;
mod devices;
mod gate;
mod mdns;
mod pairing;
mod proxy;
pub(crate) mod secret_store;

use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};

use hyper::header::HeaderValue;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tauri::{AppHandle, Runtime};
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::harness::{HarnessEndpointView, HarnessStatus, HarnessSupervisor};

pub(crate) use body::RemoteBody;
pub(crate) use devices::{DeviceView, Devices};
pub(crate) use pairing::PairingState;

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
    /// The name the home network can type (`mdns.rs`): published when the
    /// listener starts, withdrawn when it stops, never a failure of either.
    mdns: Mutex<mdns::Mdns>,
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
    /// to the person as the sentence it is. Before the bind, two guards run:
    /// the credential store must be usable (pairing cannot work without it),
    /// and the first pairing code is minted, so the screen that follows the
    /// switch has something to show.
    pub async fn start<R: Runtime>(
        &self,
        app: AppHandle<R>,
        supervisor: HarnessSupervisor,
        devices: Arc<Devices>,
        pairing: Arc<PairingState>,
    ) -> Result<SocketAddr, String> {
        if let Some(address) = self.address() {
            return Ok(address);
        }

        if !devices.available() {
            return Err(
                "Studio cannot reach this machine's credential store, so it cannot pair other \
                 devices; nothing has been opened to them."
                    .to_owned(),
            );
        }

        // The code the settings screen shows (ADR 0050 §3.4): switching the
        // feature on makes Studio show a pairing code.
        pairing.mint(std::time::Instant::now());

        let port = configured_port();
        // Network-facing, deliberately, and only in the same change that
        // carries the gate. See the module note.
        let address = SocketAddr::from((Ipv4Addr::UNSPECIFIED, port));
        let listener = match TcpListener::bind(address).await {
            Ok(listener) => listener,
            Err(error) => {
                // The port being taken and a second starter are the same
                // symptom: a starter that lost a race to an existing listener
                // is answered with that listener, not an error.
                if let Some(address) = self.address() {
                    return Ok(address);
                }
                return Err(format!(
                    "Studio could not open port {port} for other devices: {error}"
                ));
            }
        };
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

        // The frontend assets. The closure exists so that the routing below
        // is testable without an app handle: the tests hand a stub in the
        // same place, and the gate's ordering is what the tests pin.
        let assets = {
            let app = app.clone();
            move |path: &str| assets::serve(&app, path)
        };

        tauri::async_runtime::spawn(async move {
            loop {
                let accepted = tokio::select! {
                    _ = stopped.changed() => break,
                    accepted = listener.accept() => accepted,
                };
                let Ok((stream, peer)) = accepted else {
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
                let supervisor = supervisor.clone();
                let devices = devices.clone();
                let pairing = pairing.clone();
                let assets = assets.clone();
                let peer = peer.ip();
                tauri::async_runtime::spawn(async move {
                    let io = TokioIo::new(stream);
                    // The clones happen per request, and the async block owns
                    // them: a future that borrowed from this closure would
                    // not satisfy hyper's `Service` (the same shape the
                    // listener first shipped with).
                    let service = service_fn(move |request| {
                        let assets = assets.clone();
                        let supervisor = supervisor.clone();
                        let devices = devices.clone();
                        let pairing = pairing.clone();
                        async move {
                            handle(
                                &assets,
                                &supervisor,
                                &devices,
                                &pairing,
                                peer,
                                request,
                            )
                            .await
                        }
                    });
                    if let Err(error) = http1::Builder::new().serve_connection(io, service).await
                    {
                        log::debug!("Remote access: connection ended: {error}");
                    }
                });
            }
            log::info!("Remote access: stopped serving {address}");
        });

        // The name the home network can type, published only now - the port
        // is bound and being served - because a name published for a port
        // that refuses would be a name that lies.
        self.publish_name(address.port());

        log::info!("Remote access: serving {address} (devices gate on)");
        Ok(address)
    }

    /// Publishes `studio.local` for `port` over the machine's home addresses.
    ///
    /// Every failure is a log line, never a failed start: mDNS is the
    /// friendly name, and the QR code and the raw address answer without it.
    fn publish_name(&self, port: u16) {
        let Ok(mut publisher) = self.mdns.lock() else {
            log::warn!(
                "Remote access: lost track of the name publisher, so studio.local is not published."
            );
            return;
        };
        publisher.publish(port, &mdns::home_addresses());
    }

    /// Withdraws the name. Never fails its caller, and safe to call when
    /// nothing was ever published.
    fn withdraw_name(&self) {
        let Ok(mut publisher) = self.mdns.lock() else {
            return;
        };
        publisher.withdraw();
    }

    /// Stops the listener, drops every connection, and withdraws the name.
    /// Idempotent.
    pub fn stop(&self) {
        {
            let Ok(mut running) = self.running.lock() else {
                return;
            };
            if let Some(running) = running.take() {
                // The accept loop sees this and breaks, which drops the
                // listener and closes the port. Connections already open end
                // with it.
                let _ = running.stop.send(true);
            }
        }
        // The name goes with the port: a published name for a port that no
        // longer answers is a name that lies.
        self.withdraw_name();
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

/// The two supervisor questions a paired device is served by this process
/// rather than by the harness.
///
/// On the desktop the webview asks them as Tauri commands (`get_harness_status`,
/// `restart_harness`); a browser has no command channel, and without an answer
/// it cannot even attach to a conversation - the contact that opens every read
/// begins by asking whether the harness is running. These two routes are that
/// ask, over HTTP, at paths the harness itself does not own (nothing under
/// `/api/harness` exists on the harness side), so there is no question of which
/// server a path belongs to.
enum SupervisorRoute {
    Status,
    Restart,
}

fn supervisor_route(path: &str, method: &Method) -> Option<SupervisorRoute> {
    match (method, path) {
        (&Method::GET, "/api/harness/status") => Some(SupervisorRoute::Status),
        (&Method::POST, "/api/harness/restart") => Some(SupervisorRoute::Restart),
        _ => None,
    }
}

/// Answers one supervisor route.
///
/// Status is a read and answers immediately. Restart runs the same polite
/// stop-and-start the desktop command does, which can hold for the whole
/// readiness window, so it goes to the blocking pool: a restart must make the
/// device that asked wait, not the runtime that is serving everyone else.
///
/// Both are answered after the gate and before the harness endpoint lookup -
/// after, because they are supervisor questions and a paired device is exactly
/// who may ask them; before, because the status route exists to answer while
/// the harness is *down*, which the endpoint check would turn into the 503 that
/// says nothing about why.
async fn supervisor_answer(
    supervisor: &HarnessSupervisor,
    route: SupervisorRoute,
) -> Response<RemoteBody> {
    match route {
        SupervisorRoute::Status => status_answered(supervisor.status()),
        SupervisorRoute::Restart => {
            let owned = supervisor.clone();
            // Mapped to the view inside the blocking task, where the endpoint
            // type is nameable: the bearer never crosses into an answer, and
            // what the mapping below works on is already the view.
            let restarted =
                tauri::async_runtime::spawn_blocking(move || {
                    owned.restart().map(HarnessEndpointView::from)
                })
                .await;
            match restarted {
                Ok(restarted) => restart_answered(restarted),
                Err(_) => proxy::refusal(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "The restart was asked of Studio's supervisor and did not come back.",
                ),
            }
        }
    }
}

/// A status read, as an answer. The shape is the supervisor command's own -
/// `state`, the endpoint view or nothing, the failure sentence or nothing - so
/// a page reads one status vocabulary wherever the answer came from.
fn status_answered(status: HarnessStatus) -> Response<RemoteBody> {
    let body = serde_json::to_string(&status)
        .unwrap_or_else(|_| r#"{"error":"The harness status could not be written."}"#.to_owned());
    let mut response = Response::new(RemoteBody::full(body));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        hyper::header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response
}

/// A restart's outcome, as an answer.
///
/// A landed restart answers with the status that now holds - running, with the
/// endpoint view - and a refused one carries the supervisor's own sentence on
/// a 500: the sentence is redacted at its source, the same one a status read
/// hands back, and 500 is the honest code for "the thing you asked could not
/// be done", a harness being down being this hop's normal and answerable
/// state, not an error in it.
fn restart_answered(restarted: Result<HarnessEndpointView, String>) -> Response<RemoteBody> {
    match restarted {
        Ok(endpoint) => status_answered(HarnessStatus {
            state: "running",
            endpoint: Some(endpoint),
            error: None,
        }),
        Err(error) => proxy::refusal(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

/// One request from a device.
///
/// The routing order is the security property, and it is stated once, here,
/// where the order is decided: the pairing routes are served before the gate
/// (they are how a device becomes paired at all), the harness paths are gated
/// before they are forwarded, and everything else is the public shell.
///
/// Generic over the request body for the same reason `proxy::forward` and
/// `gate::serve_pairing` are: hyper's `Incoming` has no public constructor, so
/// a test that needed one could not be written at all.
async fn handle<A, B>(
    assets: &A,
    supervisor: &HarnessSupervisor,
    devices: &Devices,
    pairing: &PairingState,
    peer: IpAddr,
    request: Request<B>,
) -> Result<Response<RemoteBody>, Infallible>
where
    A: Fn(&str) -> Response<RemoteBody>,
    B: hyper::body::Body<Data = bytes::Bytes> + Send + 'static,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    let path = request.uri().path().to_owned();

    // The pairing routes, served here rather than forwarded: they are how a
    // browser becomes paired at all, so they are reachable without a cookie,
    // and they are the only harness-prefixed paths that are.
    if let Some(route) = gate::pairing_route(&path, request.method()) {
        let response = gate::serve_pairing(devices, pairing, route, peer, request).await;
        return Ok(response);
    }

    if proxy::is_harness_path(&path) {
        // The gate: a request without a current device cookie goes no further.
        let revoked = match gate::authorize_request(request.headers(), devices) {
            Ok(revoked) => revoked,
            Err(refused) => return Ok(refused),
        };
        // The supervisor's own routes, answered here rather than forwarded -
        // and after the gate, before the endpoint check, for the reasons on
        // `supervisor_answer`. The method is matched before `forward` moves
        // the request.
        if let Some(route) = supervisor_route(&path, request.method()) {
            return Ok(supervisor_answer(supervisor, route).await);
        }
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
        return Ok(proxy::forward(&upstream, request, revoked).await);
    }

    Ok(assets(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::secret_store::MemorySecretStore;
    use bytes::Bytes;

    /// Serves the harness nothing, so every forwarded request answers 503;
    /// the tests below read the gate's behaviour off the refusal they get.
    fn fresh_supervisor() -> HarnessSupervisor {
        HarnessSupervisor::new()
    }

    /// A stand-in for the frontend: every path is "an asset".
    fn asset(path: &str) -> Response<RemoteBody> {
        let mut response = Response::new(RemoteBody::full(format!("asset:{path}")));
        *response.status_mut() = StatusCode::OK;
        response
    }

    fn devices() -> Devices {
        Devices::open(MemorySecretStore::new().handle())
    }

    /// Reads a response body to the end. Bounded: a bug that never finishes
    /// fails the test instead of hanging it.
    async fn body_text(response: Response<RemoteBody>) -> String {
        let bytes = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            http_body_util::BodyExt::collect(response.into_body()),
        )
        .await
        .expect("the body never finished")
        .expect("the body failed")
        .to_bytes();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// The routing through `handle` itself, since the order — pairing before
    /// the gate, the gate before the harness — is the security property.
    async fn route(
        supervisor: &HarnessSupervisor,
        devices: &Devices,
        pairing: &PairingState,
        request: Request<http_body_util::Full<Bytes>>,
    ) -> Response<RemoteBody> {
        let peer: IpAddr = "192.168.1.50".parse().unwrap();
        handle(&asset, supervisor, devices, pairing, peer, request)
            .await
            .unwrap_or_else(|infallible| match infallible {})
    }

    #[tokio::test]
    async fn an_unpaired_device_is_refused_before_the_harness_is_even_consulted() {
        let supervisor = fresh_supervisor();
        let devices = devices();
        let pairing_state = PairingState::default();

        // The harness is not running at all: an unpaired request must be
        // refused by the gate (401), never answered by the harness-down
        // response (503). The gate comes first, or an attacker would learn
        // the machine's state without a credential.
        let response = route(
            &supervisor,
            &devices,
            &pairing_state,
            Request::builder()
                .uri("/api/conversations")
                .body(http_body_util::Full::new(Bytes::new()))
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn a_paired_device_reaches_the_harness_path() {
        let supervisor = fresh_supervisor();
        let devices = devices();
        let pairing_state = PairingState::default();
        let paired = devices.pair("Phone", 0).unwrap();

        let response = route(
            &supervisor,
            &devices,
            &pairing_state,
            Request::builder()
                .uri("/api/conversations")
                .header(hyper::header::COOKIE, format!("studio_device={}", paired.cookie))
                .body(http_body_util::Full::new(Bytes::new()))
                .unwrap(),
        )
        .await;
        // The gate let it through; the harness being absent is the next
        // answer, and a different one.
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn the_pairing_routes_are_reachable_without_a_cookie() {
        let supervisor = fresh_supervisor();
        let devices = devices();
        let pairing_state = PairingState::default();

        let response = route(
            &supervisor,
            &devices,
            &pairing_state,
            Request::builder()
                .uri("/api/pairing/state")
                .body(http_body_util::Full::new(Bytes::new()))
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body_text(response).await, r#"{"paired":false}"#);
    }

    #[tokio::test]
    async fn pairing_through_the_listener_then_reaching_the_harness() {
        let supervisor = fresh_supervisor();
        let devices = devices();
        let pairing_state = PairingState::default();
        let code = pairing_state.mint(std::time::Instant::now());

        // Pair, exactly as a phone would.
        let body = serde_json::json!({ "code": code }).to_string();
        let response = route(
            &supervisor,
            &devices,
            &pairing_state,
            Request::builder()
                .method("POST")
                .uri("/api/pairing")
                .body(http_body_util::Full::new(Bytes::from(body)))
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let cookie = response
            .headers()
            .get(hyper::header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned();

        // The very same credential reaches the harness path.
        let response = route(
            &supervisor,
            &devices,
            &pairing_state,
            Request::builder()
                .uri("/api/conversations")
                .header(hyper::header::COOKIE, cookie)
                .body(http_body_util::Full::new(Bytes::new()))
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn a_frontend_asset_is_public_but_the_gate_is_not() {
        let supervisor = fresh_supervisor();
        let devices = devices();
        let pairing_state = PairingState::default();

        // The shell is public: the pairing screen is part of it.
        let response = route(
            &supervisor,
            &devices,
            &pairing_state,
            Request::builder()
                .uri("/")
                .body(http_body_util::Full::new(Bytes::new()))
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);

        // And the harness path right next to it is not.
        let response = route(
            &supervisor,
            &devices,
            &pairing_state,
            Request::builder()
                .uri("/agents/studio/cnv_1")
                .body(http_body_util::Full::new(Bytes::new()))
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    /// The two supervisor routes a paired device is served by this process.
    #[test]
    fn the_supervisor_routes_are_the_two_exact_methods_and_paths() {
        assert!(matches!(
            supervisor_route("/api/harness/status", &Method::GET),
            Some(SupervisorRoute::Status)
        ));
        assert!(matches!(
            supervisor_route("/api/harness/restart", &Method::POST),
            Some(SupervisorRoute::Restart)
        ));
        // Wrong method, wrong path, near misses: none of them is intercepted,
        // and each would be forwarded (or refused) by the rules that were
        // already true.
        assert!(supervisor_route("/api/harness/status", &Method::POST).is_none());
        assert!(supervisor_route("/api/harness/restart", &Method::GET).is_none());
        assert!(supervisor_route("/api/harness/statuses", &Method::GET).is_none());
        assert!(supervisor_route("/api/harness", &Method::GET).is_none());
        assert!(supervisor_route("/api/shutdown", &Method::GET).is_none());
    }

    #[tokio::test]
    async fn the_status_route_answers_while_the_harness_is_down() {
        let supervisor = fresh_supervisor();
        let devices = devices();
        let pairing_state = PairingState::default();
        let paired = devices.pair("Phone", 0).unwrap();

        let response = route(
            &supervisor,
            &devices,
            &pairing_state,
            Request::builder()
                .uri("/api/harness/status")
                .header(
                    hyper::header::COOKIE,
                    format!("studio_device={}", paired.cookie),
                )
                .body(http_body_util::Full::new(Bytes::new()))
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_text(response).await;
        // A fresh supervisor has not tried anything, so `stopped` is the truth
        // - and this is the route's whole reason to exist: the endpoint check
        // below it would have answered 503 and said nothing about why.
        assert_eq!(body, r#"{"state":"stopped","endpoint":null,"error":null}"#);
    }

    #[tokio::test]
    async fn the_status_route_is_refused_before_the_harness_is_consulted() {
        let supervisor = fresh_supervisor();
        let devices = devices();
        let pairing_state = PairingState::default();

        // Same ordering property as every other harness path: without the
        // cookie, 401 - not the status, not the 503.
        let response = route(
            &supervisor,
            &devices,
            &pairing_state,
            Request::builder()
                .uri("/api/harness/status")
                .body(http_body_util::Full::new(Bytes::new()))
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn a_refused_restart_and_a_landed_one_map_to_the_answers_a_client_can_read() {
        // The mapping is the whole restart contract on this hop: the endpoint
        // view rides a status answer, the supervisor's own sentence rides the
        // refusal. Both are stated here without running a restart, which in
        // this crate's tests would spawn a real harness - the route's matching
        // is pinned above, and `restart` itself is the same call the desktop
        // command makes.
        let landed = restart_answered(Ok(HarnessEndpointView {
            host: "127.0.0.1".to_owned(),
            port: 4319,
            pid: 123,
            url: "http://127.0.0.1:4319".to_owned(),
            client_id: "studio-host".to_owned(),
            session_id: "session".to_owned(),
        }));
        assert_eq!(landed.status(), StatusCode::OK);
        let body = body_text(landed).await;
        assert!(
            body.contains(r#""url":"http://127.0.0.1:4319""#),
            "the endpoint view is what a device gets: {body}"
        );

        let refused = restart_answered(Err("no harness to start".to_owned()));
        assert_eq!(refused.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body = body_text(refused).await;
        assert_eq!(body, r#"{"error":"no harness to start"}"#);
    }

    /// The variable is process-wide, so every case that reads it shares one
    /// test rather than racing each other from separate ones. No other test
    /// in the crate touches this name.
    #[test]
    fn the_port_is_the_default_unless_a_usable_override_says_otherwise() {
        std::env::remove_var(PORT_VARIABLE);
        assert_eq!(configured_port(), DEFAULT_PORT);

        std::env::set_var(PORT_VARIABLE, "9123");
        assert_eq!(configured_port(), 9123);

        // Port 0 means "any free port" to the OS, which would produce an
        // address nobody could have been told in advance.
        std::env::set_var(PORT_VARIABLE, "0");
        assert_eq!(configured_port(), DEFAULT_PORT);

        std::env::set_var(PORT_VARIABLE, "not a port");
        assert_eq!(configured_port(), DEFAULT_PORT);

        std::env::remove_var(PORT_VARIABLE);
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