//! The gate: what a device must present before it is talking to the harness,
//! and the pairing routes that decide who presents what.
//!
//! The routing rule of the listener gains one layer. Three kinds of request
//! arrive, and each has its own answer:
//!
//! - **The pairing routes** (`GET /api/pairing/state`, `POST /api/pairing`)
//!   are served here, not forwarded. They are how a browser becomes paired
//!   at all, so they must be reachable without a cookie — and they are the
//!   only harness-prefixed paths that are, which is why they are matched
//!   exactly rather than by prefix.
//! - **Everything under `/api` and `/agents`** carries the gate: a request
//!   without a valid device cookie is refused before it is forwarded, and
//!   the cookie is stripped on the way through (the proxy already does
//!   that), so the harness never sees a device credential.
//! - **The frontend assets** are public. They are the shell, and the
//!   pairing screen is part of the shell; a device that cannot load the
//!   shell cannot enter its pairing code. The shell carries nothing of the
//!   person's — every fact it shows comes through the gated paths.
//!
//! That is the whole model from §3.5 of the plan: the boundary is **which
//! devices are paired**, not what a paired device may do. Once the cookie
//! validates, the request is forwarded with the same bearer the webview
//! would have used, and the harness's own admission layer does the rest.

use std::net::IpAddr;

use http_body_util::{BodyExt, Limited};
use hyper::header::{CONTENT_TYPE, COOKIE, SET_COOKIE, USER_AGENT};
use hyper::header::{HeaderMap, HeaderValue};
use hyper::{Method, Request, Response, StatusCode};
use tokio::sync::watch;

use super::body::RemoteBody;
use super::devices::{now_ms, set_cookie_value, Devices};
use super::pairing::PairingState;

/// How much of a pairing request body will be read. The body is one small
/// JSON object — a code of six characters — and the limit exists so that
/// something presenting itself as a device cannot make this process hold
/// memory while claiming to be pairing.
const MAX_PAIRING_BODY: usize = 4 * 1024;

/// The one way a browser presents itself: a cookie whose value is the device
/// credential `devices.rs` minted at pairing.
const DEVICE_COOKIE: &str = "studio_device";

/// The two routes a device may reach without being paired, and what each is
/// for. Matched exactly: a path that is *almost* one of these is forwarded
/// (and refused by the gate), never half-served here.
pub(crate) fn pairing_route(path: &str, method: &Method) -> Option<PairingRoute> {
    match (path, method) {
        ("/api/pairing/state", &Method::GET) => Some(PairingRoute::State),
        ("/api/pairing", &Method::POST) => Some(PairingRoute::Submit),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum PairingRoute {
    /// "Am I paired?" — the question the page asks before it renders
    /// anything.
    State,
    /// "Here is the code." — the one way in.
    Submit,
}

/// Serves one of the pairing routes.
///
/// Generic over the body for the same reason `proxy::forward` is: hyper's
/// `Incoming` has no public constructor, so a test that needed one could not
/// be written at all.
pub(crate) async fn serve_pairing<B>(
    devices: &Devices,
    pairing: &PairingState,
    route: PairingRoute,
    peer: IpAddr,
    request: Request<B>,
) -> Response<RemoteBody>
where
    B: hyper::body::Body<Data = bytes::Bytes> + Send + 'static,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    match route {
        PairingRoute::State => {
            let paired = authorize_request(request.headers(), devices).is_ok();
            json_response(StatusCode::OK, serde_json::json!({ "paired": paired }))
        }
        PairingRoute::Submit => submit(devices, pairing, peer, request).await,
    }
}

#[derive(serde::Deserialize)]
struct PairingSubmission {
    code: String,
}

async fn submit<B>(
    devices: &Devices,
    pairing: &PairingState,
    peer: IpAddr,
    request: Request<B>,
) -> Response<RemoteBody>
where
    B: hyper::body::Body<Data = bytes::Bytes> + Send + 'static,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    if authorize_request(request.headers(), devices).is_ok() {
        return json_response(StatusCode::OK, serde_json::json!({ "paired": true }));
    }
    let now = std::time::Instant::now();
    // The rate limit comes before anything else, and every attempt counts —
    // see `pairing::AttemptLimiter` for why refusals count too.
    if !pairing.admit_attempt(peer, now) {
        let mut response = json_refusal(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts to pair. Wait a minute and try again.",
        );
        response
            .headers_mut()
            .insert("retry-after", HeaderValue::from_static("60"));
        return response;
    }

    let (parts, body) = request.into_parts();
    let bytes = match Limited::new(body, MAX_PAIRING_BODY).collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(_) => {
            return json_refusal(
                StatusCode::PAYLOAD_TOO_LARGE,
                "That request body is larger than Studio will read.",
            )
        }
    };

    let submission: PairingSubmission = match serde_json::from_slice(&bytes) {
        Ok(submission) => submission,
        Err(_) => {
            return json_refusal(
                StatusCode::BAD_REQUEST,
                "Send the pairing code as {\"code\": \"...\"}.",
            )
        }
    };

    if !pairing.consume(&submission.code, now) {
        // The same sentence for a wrong code, a used code, and an expired
        // one: telling them apart is a detail for the log, not for whatever
        // is trying to get in.
        return json_refusal(
            StatusCode::UNAUTHORIZED,
            "That pairing code is not valid. Check the code Studio is showing.",
        );
    }

    let name = device_name_from(parts.headers.get(USER_AGENT));
    match devices.pair(&name, now_ms()) {
        Ok(paired) => {
            let mut response = json_response(StatusCode::OK, serde_json::json!({ "paired": true }));
            if let Ok(value) = HeaderValue::from_str(&set_cookie_value(&paired.cookie)) {
                response.headers_mut().insert(SET_COOKIE, value);
            }
            response
        }
        Err(error) => json_refusal(StatusCode::SERVICE_UNAVAILABLE, &error),
    }
}

/// The gate for harness paths: a valid device cookie in, a revocation signal
/// out. The signal is what ends the device's connections the moment it is
/// removed, including a stream that is mid-read.
///
/// The large `Err` is the design, not an accident: the refusal is a full
/// HTTP response because the caller's answer to it is `return Ok(refused)`,
/// one line, and boxing it would add a layer for nothing.
#[allow(clippy::result_large_err)]
pub(crate) fn authorize_request(
    headers: &HeaderMap,
    devices: &Devices,
) -> Result<(String, watch::Receiver<bool>), Response<RemoteBody>> {
    let refused = || {
        json_refusal(
            StatusCode::UNAUTHORIZED,
            "This device is not paired with Studio. Open Studio on the PC and pair this device.",
        )
    };
    let Some(cookie) = cookie_value_from(headers) else {
        return Err(refused());
    };
    match devices.authorize(&cookie, now_ms()) {
        Ok(revoked) => match cookie.split_once('.') {
            Some((id, _)) => Ok((id.to_owned(), revoked)),
            None => Err(refused()),
        },
        Err(why) => {
            // The reason is for this process's log; the device gets the same
            // refusal however it failed.
            log::info!("Remote access: refused a device credential: {why}");
            Err(refused())
        }
    }
}

/// The device cookie from among whatever cookies the browser sent.
///
/// A `Cookie` header is a semicolon list, and a request may carry several
/// headers. The first matching name wins; a cookie of another name is left
/// alone even when it starts the same.
fn cookie_value_from(headers: &HeaderMap) -> Option<String> {
    for header in headers.get_all(COOKIE) {
        let Ok(text) = header.to_str() else { continue };
        for piece in text.split(';') {
            if let Some((name, value)) = piece.trim().split_once('=') {
                if name.trim() == DEVICE_COOKIE {
                    return Some(value.trim().to_owned());
                }
            }
        }
    }
    None
}

/// The name a device carries until the person renames it: what its own
/// browser says it is. Best-effort on purpose — `rename` is the real answer,
/// and a phone that arrives as "Android device" is one rename away from
/// being recognisable.
fn device_name_from(user_agent: Option<&HeaderValue>) -> String {
    let Some(ua) = user_agent.and_then(|value| value.to_str().ok()) else {
        return "Paired device".to_owned();
    };
    let device = if ua.contains("iPhone") {
        "iPhone"
    } else if ua.contains("iPad") {
        "iPad"
    } else if ua.contains("Android") {
        "Android"
    } else if ua.contains("CrOS") {
        "Chromebook"
    } else if ua.contains("Windows") {
        "Windows PC"
    } else if ua.contains("Macintosh") || ua.contains("Mac OS") {
        "Mac"
    } else if ua.contains("Linux") {
        "Linux"
    } else {
        "device"
    };
    let browser = if ua.contains("Edg/") || ua.contains("EdgA/") || ua.contains("EdgiOS/") {
        "Edge"
    } else if ua.contains("OPR/") || ua.contains("OPiOS/") {
        "Opera"
    } else if ua.contains("Firefox/") || ua.contains("FxiOS/") {
        "Firefox"
    } else if ua.contains("Chrome/") || ua.contains("CriOS/") {
        "Chrome"
    } else if ua.contains("Safari/") {
        "Safari"
    } else {
        "Browser"
    };
    format!("{browser} on {device}")
}

fn json_response(status: StatusCode, body: serde_json::Value) -> Response<RemoteBody> {
    let mut response = Response::new(RemoteBody::full(body.to_string()));
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response.headers_mut().insert("cache-control", HeaderValue::from_static("no-store"));
    response
}

fn json_refusal(status: StatusCode, message: &str) -> Response<RemoteBody> {
    json_response(status, serde_json::json!({ "error": message }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::devices::COOKIE_NAME;
    use bytes::Bytes;
    use http_body_util::Full;

    fn pairing() -> PairingState {
        PairingState::default()
    }

    /// A pairing POST whose body is this JSON.
    fn submit_request(code: &str) -> Request<http_body_util::Full<Bytes>> {
        let body = serde_json::json!({ "code": code }).to_string();
        Request::builder()
            .header(USER_AGENT, "Mozilla/5.0 (Linux; Android 14; Pixel 8)")
            .body(Full::new(Bytes::from(body)))
            .unwrap()
    }

    fn cookie_header(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        let mut full = String::from("other_cookie=noise; ");
        full.push_str(&format!("{COOKIE_NAME}={value}"));
        headers.insert(COOKIE, HeaderValue::from_str(&full).unwrap());
        headers
    }

    #[test]
    fn the_pairing_routes_are_matched_exactly() {
        assert!(matches!(
            pairing_route("/api/pairing/state", &Method::GET),
            Some(PairingRoute::State)
        ));
        assert!(matches!(
            pairing_route("/api/pairing", &Method::POST),
            Some(PairingRoute::Submit)
        ));

        // Almost is not: the gate takes these, because a path that is not
        // one of the two routes must not be served unpaired.
        assert!(pairing_route("/api/pairing", &Method::GET).is_none());
        assert!(pairing_route("/api/pairing/state", &Method::POST).is_none());
        assert!(pairing_route("/api/pairing/other", &Method::GET).is_none());
        assert!(pairing_route("/api/pairingx", &Method::POST).is_none());
        assert!(pairing_route("/api/pairing/../state", &Method::GET).is_none());
    }

    #[test]
    fn the_device_cookie_is_found_among_others() {
        assert_eq!(
            cookie_value_from(&cookie_header("pd_a.secret")),
            Some("pd_a.secret".to_owned())
        );
        // Several cookies in one header, and the device one not first.
        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            HeaderValue::from_static("theme=dark; studio_device=pd_x.secret; session=zzz"),
        );
        assert_eq!(
            cookie_value_from(&headers),
            Some("pd_x.secret".to_owned())
        );
        // Absent, or merely similar.
        assert_eq!(cookie_value_from(&HeaderMap::new()), None);
        let mut headers = HeaderMap::new();
        headers.insert(COOKIE, HeaderValue::from_static("studio_device_extra=1"));
        assert_eq!(cookie_value_from(&headers), None);
    }

    #[test]
    fn a_device_is_named_from_what_its_browser_says_it_is() {
        assert_eq!(
            device_name_from(Some(&HeaderValue::from_static(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
            ))),
            "Browser on iPhone"
        );
        assert_eq!(
            device_name_from(Some(&HeaderValue::from_static(
                "Mozilla/5.0 (Linux; Android 14; Pixel 8)"
            ))),
            "Browser on Android"
        );
        assert_eq!(
            device_name_from(Some(&HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            ))),
            "Browser on Windows PC"
        );
        assert_eq!(
            device_name_from(None),
            "Paired device",
            "a browser that says nothing is not refused pairing for it"
        );
    }

    #[tokio::test]
    async fn the_state_route_answers_whether_this_request_is_paired() {
        let store = crate::remote::secret_store::MemorySecretStore::new();
        let devices = Devices::open(store.handle());
        let pairing_state = pairing();

        // Without a cookie: not paired, answered plainly.
        let unpaired = serve_pairing(
            &devices,
            &pairing_state,
            PairingRoute::State,
            "192.168.1.50".parse().unwrap(),
            Request::builder().body(Full::new(Bytes::new())).unwrap(),
        )
        .await;
        assert_eq!(unpaired.status(), StatusCode::OK);
        assert_eq!(body_text(unpaired).await, r#"{"paired":false}"#);

        // With the cookie of a device that was paired a moment ago: paired.
        let paired_device = devices.pair("Phone", 0).unwrap();
        let request = Request::builder()
            .header(COOKIE, format!("{COOKIE_NAME}={}", paired_device.cookie))
            .body(Full::new(Bytes::new()))
            .unwrap();
        let paired = serve_pairing(
            &devices,
            &pairing_state,
            PairingRoute::State,
            "192.168.1.50".parse().unwrap(),
            request,
        )
        .await;
        assert_eq!(paired.status(), StatusCode::OK);
        assert_eq!(body_text(paired).await, r#"{"paired":true}"#);
    }

    #[tokio::test]
    async fn a_valid_code_pairs_the_device_and_sets_the_cookie() {
        let store = crate::remote::secret_store::MemorySecretStore::new();
        let devices = Devices::open(store.handle());
        let pairing_state = pairing();
        let code = pairing_state.mint(std::time::Instant::now());

        let response = serve_pairing(
            &devices,
            &pairing_state,
            PairingRoute::Submit,
            "192.168.1.50".parse().unwrap(),
            submit_request(&code),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");

        // The cookie the response sets is the credential the device keeps,
        // and it is HttpOnly and SameSite=Strict.
        let cookie = response
            .headers()
            .get(SET_COOKIE)
            .expect("a pairing must set the cookie")
            .to_str()
            .unwrap()
            .to_owned();
        assert!(cookie.starts_with(&format!("{COOKIE_NAME}=")));
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Strict"));

        // The cookie it set actually admits.
        let value = cookie.split(';').next().unwrap().split_once('=').unwrap().1;
        assert!(authorize_request(&cookie_header(value), &devices).is_ok());
        // The device it created is on the list, named from its user agent.
        assert_eq!(devices.list()[0].name, "Browser on Android");
    }

    #[tokio::test]
    async fn an_already_paired_browser_does_not_create_another_device_or_consume_a_code() {
        let store = crate::remote::secret_store::MemorySecretStore::new();
        let devices = Devices::open(store.handle());
        let paired = devices.pair("Phone", now_ms()).unwrap();
        let pairing_state = pairing();
        let code = pairing_state.code(std::time::Instant::now(), false);
        let mut request = submit_request(&code);
        *request.headers_mut() = cookie_header(&paired.cookie);
        let response = serve_pairing(&devices, &pairing_state, PairingRoute::Submit,
            "192.168.1.50".parse().unwrap(), request).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(devices.list().len(), 1);
        assert!(pairing_state.consume(&code, std::time::Instant::now()));
    }

    #[test]
    fn browser_labels_distinguish_browser_families_before_chromium() {
        for (agent, expected) in [
            ("Windows Chrome/128 Safari/537 Edg/128", "Edge on Windows PC"),
            ("Windows Chrome/128 Safari/537 OPR/114", "Opera on Windows PC"),
            ("Windows Chrome/128 Safari/537", "Chrome on Windows PC"),
            ("iPhone CriOS/128 Safari/604", "Chrome on iPhone"),
            ("Macintosh Version/18 Safari/605", "Safari on Mac"),
            ("Linux Firefox/132", "Firefox on Linux"),
        ] {
            assert_eq!(device_name_from(Some(&HeaderValue::from_static(agent))), expected);
        }
    }

    #[tokio::test]
    async fn a_wrong_or_used_or_expired_code_is_the_same_refusal() {
        let store = crate::remote::secret_store::MemorySecretStore::new();
        let devices = Devices::open(store.handle());
        let pairing_state = pairing();
        let code = pairing_state.mint(std::time::Instant::now());

        // First, a wrong code.
        let wrong = serve_pairing(
            &devices,
            &pairing_state,
            PairingRoute::Submit,
            "192.168.1.50".parse().unwrap(),
            submit_request("ZZZZZZ"),
        )
        .await;
        assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);

        // Then the right one — which is consumed — and then again.
        let right = serve_pairing(
            &devices,
            &pairing_state,
            PairingRoute::Submit,
            "192.168.1.50".parse().unwrap(),
            submit_request(&code),
        )
        .await;
        assert_eq!(right.status(), StatusCode::OK);
        let reused = serve_pairing(
            &devices,
            &pairing_state,
            PairingRoute::Submit,
            "192.168.1.51".parse().unwrap(),
            submit_request(&code),
        )
        .await;
        assert_eq!(reused.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            reused.status(),
            wrong.status(),
            "the refusal does not say which kind of invalid it was"
        );
    }

    #[tokio::test]
    async fn a_malformed_or_oversized_body_is_refused_before_the_code_is_checked() {
        let store = crate::remote::secret_store::MemorySecretStore::new();
        let devices = Devices::open(store.handle());
        let pairing_state = pairing();

        let malformed = Request::builder()
            .body(Full::new(Bytes::from("not json")))
            .unwrap();
        let response = serve_pairing(
            &devices,
            &pairing_state,
            PairingRoute::Submit,
            "192.168.1.50".parse().unwrap(),
            malformed,
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let oversized = Request::builder()
            .body(Full::new(Bytes::from("x".repeat(MAX_PAIRING_BODY + 1))))
            .unwrap();
        let response = serve_pairing(
            &devices,
            &pairing_state,
            PairingRoute::Submit,
            "192.168.1.50".parse().unwrap(),
            oversized,
        )
        .await;
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn the_sixth_pairing_attempt_from_one_address_is_refused() {
        let store = crate::remote::secret_store::MemorySecretStore::new();
        let devices = Devices::open(store.handle());
        let pairing_state = pairing();
        let peer: IpAddr = "192.168.1.50".parse().unwrap();

        for attempt in 0..5 {
            let response = serve_pairing(
                &devices,
                &pairing_state,
                PairingRoute::Submit,
                peer,
                submit_request("WRONG0"),
            )
            .await;
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "attempt {attempt}");
        }
        let sixth = serve_pairing(
            &devices,
            &pairing_state,
            PairingRoute::Submit,
            peer,
            submit_request("WRONG0"),
        )
        .await;
        assert_eq!(sixth.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            sixth.headers().get("retry-after").unwrap(),
            "60",
            "the device is told how long the cooldown is"
        );
    }

    /// Reads a JSON body to the end. Bounded, so a bug that never finishes
    /// fails the test instead of hanging it.
    async fn body_text(response: Response<RemoteBody>) -> String {
        let bytes = tokio::time::timeout(std::time::Duration::from_secs(5), response.into_body().collect())
            .await
            .expect("the body never finished")
            .expect("the body failed")
            .to_bytes();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}
