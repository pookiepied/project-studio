//! Forwarding one request from a device to the harness.
//!
//! This is the hop that makes remote access possible without weakening
//! anything. The harness stays bound to loopback and stays reachable only by
//! something already on the machine (ADR 0028); the per-launch bearer stays
//! inside Rust and is never sent to a device (ADR 0044). A phone's request
//! arrives here with no credential of the machine's at all, and leaves here
//! for `127.0.0.1` carrying the bearer this process holds — the same
//! attachment `service_fetch` performs for the webview, at the same seam, with
//! the same path rule.
//!
//! ---- Everything streams -----------------------------------------------
//!
//! There is no branch here that decides whether a response is "a stream" and
//! buffers the ones that are not. Every response is forwarded chunk by chunk
//! as it arrives.
//!
//! That is a deliberate refusal of a heuristic. A proxy that buffers by
//! default and streams when it recognises a stream will one day fail to
//! recognise one, and the symptom — a turn that appears complete at the end
//! instead of arriving live — looks like a broken conversation client rather
//! than a hop that ate the response. Streaming everything has one path, one
//! behaviour, and nothing to misidentify. The cost is that a small JSON reply
//! goes out chunked instead of with a `Content-Length`, which no client cares
//! about.
//!
//! The one thing the request's shape does decide is the deadline, and only
//! because the two cases genuinely differ: see [`is_long_lived`].

use std::time::Duration;

use http_body_util::{BodyExt, Limited};
use hyper::header::{HeaderMap, HeaderName, HeaderValue};
use hyper::{Request, Response, StatusCode};
use tokio::sync::mpsc;
use tokio::sync::watch;

use crate::harness::supervisor::redact;
use crate::services::{canonical_route, validate_path};

use super::body::RemoteBody;

/// How long a request that is not a live stream may take in total.
///
/// Matches `service_fetch`'s bound and exists for the same reason: a wedged
/// harness must not hold a connection open forever. A stream is exempt, since
/// a healthy stream can legitimately run for hours.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// A bound on how long reaching loopback may take. Generous for a connection
/// to the same machine, and short enough that a harness which is not there
/// answers quickly rather than hanging the device's page.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// How much of a request body this hop will hold.
///
/// Bodies here are JSON: a message, a setting, an approval answer. The cap is
/// far above anything the frontend sends and far below anything that would
/// matter to the process, and it exists so that a device — or something
/// pretending to be one — cannot make this process hold arbitrary memory by
/// starting a request body it never finishes.
const MAX_REQUEST_BODY: usize = 32 * 1024 * 1024;

/// How many chunks may sit between the harness and the device before the pump
/// waits.
///
/// Backpressure, not buffering: when a device reads more slowly than the
/// harness produces, the pump blocks on the channel and stops pulling from the
/// harness, which is what a slow reader should cause. A large buffer here
/// would instead absorb the difference in memory and defer the problem.
const CHUNK_BUFFER: usize = 16;

/// Where the harness is and what admits a request to it.
///
/// Passed in rather than read from the supervisor here, so that the forwarding
/// behaviour can be tested against an ordinary local server with no Tauri app
/// and no supervised child process.
#[derive(Debug, Clone)]
pub(crate) struct Upstream {
    /// The harness's base URL, e.g. `http://127.0.0.1:51234`.
    pub(crate) url: String,
    /// The per-launch bearer. Never sent to a device; attached on the way out.
    pub(crate) token: String,
}

/// Constructed only after the device gate verifies the credential.
#[derive(Clone)]
pub(crate) struct PairedSource(pub(crate) String);

/// Headers that describe one hop and must not be copied to the next.
///
/// Forwarding these is the classic proxy bug: `Transfer-Encoding` and
/// `Content-Length` describe how the *upstream* framed its body, and this hop
/// re-frames it, so copying either announces a shape the connection does not
/// have. `Connection` and its relatives are per-connection by definition.
const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
];

fn is_hop_by_hop(name: &HeaderName) -> bool {
    HOP_BY_HOP.contains(&name.as_str())
}

/// Whether this request is one that may legitimately stay open for hours.
///
/// Two signals, either of which is enough. `Accept: text/event-stream` is what
/// a browser's own `EventSource` sends and what the conversation client sends
/// when it reads with `fetch`; `live=sse` is the harness's own query parameter
/// for the same thing (ADR 0045). Reading both means a client that uses one
/// convention is not cut off after thirty seconds because it did not use the
/// other.
fn is_long_lived<B>(request: &Request<B>) -> bool {
    if request
        .uri()
        .query()
        .is_some_and(|query| query.contains("live=sse"))
    {
        return true;
    }
    request
        .headers()
        .get(hyper::header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|accept| accept.contains("text/event-stream"))
}

/// A refusal this hop generates itself, in the harness's own vocabulary.
///
/// Shaped like the harness's errors (`{"error": "..."}`) so a client has one
/// thing to read whether a refusal came from here or from further in.
pub(crate) fn refusal(status: StatusCode, message: &str) -> Response<RemoteBody> {
    let body = serde_json::json!({ "error": message }).to_string();
    let mut response = Response::new(RemoteBody::full(body));
    *response.status_mut() = status;
    response.headers_mut().insert(
        hyper::header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response
}

/// Forwards one request to the harness and answers with what comes back.
///
/// Never returns an error: every failure becomes a response, because this is
/// the outermost layer a device talks to and a device deserves a status and a
/// sentence rather than a dropped connection.
///
/// `revoked` is the device's revocation signal from the gate. The pump selects
/// on it, so removing a device ends its connections — a stream mid-read
/// included — instead of leaving a removed device's open request running
/// until it happens to finish.
pub(crate) async fn forward<B>(
    upstream: &Upstream,
    request: Request<B>,
    revoked: watch::Receiver<bool>,
) -> Response<RemoteBody>
where
    B: hyper::body::Body<Data = bytes::Bytes> + Send + 'static,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    let path_and_query = request
        .uri()
        .path_and_query()
        .map(|value| value.as_str().to_owned())
        .unwrap_or_else(|| request.uri().path().to_owned());

    // The same rule the webview's seam applies, for the same reasons, and
    // including the same denylist: `/api/shutdown` stops the harness process,
    // and stopping it is the host's decision made on the process's own
    // channels — not something a device on the network gets to ask for.
    if let Err(error) = validate_path(&path_and_query) {
        return refusal(StatusCode::BAD_REQUEST, &error.message());
    }

    // Diagnostics may contain other conversations; pairing is not diagnostic consent.
    let canonical = canonical_route(&path_and_query);
    if canonical == "/api/diagnostics" || canonical.starts_with("/api/diagnostics/") ||
        canonical == "/api/observations/native" || canonical.starts_with("/api/observations/native/") {
        return refusal(StatusCode::FORBIDDEN, "Diagnostics are available only on the local Studio host.");
    }

    let long_lived = is_long_lived(&request);
    let (parts, body) = request.into_parts();

    let body = match Limited::new(body, MAX_REQUEST_BODY).collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(_) => {
            return refusal(
                StatusCode::PAYLOAD_TOO_LARGE,
                "That request body is larger than Studio will forward.",
            );
        }
    };

    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT);
    if !long_lived {
        builder = builder.timeout(REQUEST_TIMEOUT);
    }
    let client = match builder.build() {
        Ok(client) => client,
        Err(error) => {
            return refusal(
                StatusCode::INTERNAL_SERVER_ERROR,
                &redact(&error.to_string(), &upstream.token),
            );
        }
    };

    let method = match reqwest::Method::from_bytes(parts.method.as_str().as_bytes()) {
        Ok(method) => method,
        Err(_) => return refusal(StatusCode::BAD_REQUEST, "That is not a valid HTTP method."),
    };

    let mut outgoing = client.request(method, format!("{}{}", upstream.url, path_and_query));
    for (name, value) in parts.headers.iter() {
        // `Host` is the device's idea of where it sent the request and would
        // be wrong for loopback; `Authorization` is this seam's to set, and
        // letting a device's own value through would send it to the harness
        // in place of the bearer.
        if is_hop_by_hop(name)
            || name == hyper::header::HOST
            || name == hyper::header::AUTHORIZATION
            || name == hyper::header::COOKIE
            || name.as_str() == "x-project-studio-device-id"
        {
            continue;
        }
        outgoing = outgoing.header(name.as_str(), value.as_bytes());
    }
    outgoing = outgoing.bearer_auth(&upstream.token);
    if let Some(device) = parts.extensions.get::<PairedSource>() {
        outgoing = outgoing.header("x-project-studio-device-id", &device.0);
    }
    if !body.is_empty() {
        outgoing = outgoing.body(body);
    }

    let upstream_response = match outgoing.send().await {
        Ok(response) => response,
        Err(error) => {
            // Redacted for the same reason `service_fetch` redacts: a reqwest
            // error can carry the composed URL, and the bearer rides in the
            // headers of the request it describes.
            return refusal(
                StatusCode::BAD_GATEWAY,
                &redact(&error.to_string(), &upstream.token),
            );
        }
    };

    let status = upstream_response.status();
    let headers = forwarded_headers(upstream_response.headers());

    let (sender, receiver) = mpsc::channel(CHUNK_BUFFER);
    let token = upstream.token.clone();
    // `tokio::spawn` rather than `tauri::async_runtime::spawn`, which is the
    // same choice `service_stream` makes and for a reason worth stating: this
    // runs on whatever runtime is already driving the call, so the pump lives
    // beside its caller. Tauri's spawn names a different, global runtime -
    // fine inside the running app, and silently unreached under a plain
    // `#[tokio::test]`, where the body then waits for chunks nothing is
    // sending. A hang is the worst way to learn that.
    tokio::spawn(async move {
        pump(upstream_response, sender, token, revoked).await;
    });

    let mut response = Response::new(RemoteBody::streaming(receiver));
    *response.status_mut() = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    *response.headers_mut() = headers;
    response
}

/// The upstream's headers, minus the ones that belong to its connection
/// rather than to its answer.
fn forwarded_headers(upstream: &reqwest::header::HeaderMap) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for (name, value) in upstream.iter() {
        let Ok(name) = HeaderName::from_bytes(name.as_str().as_bytes()) else {
            continue;
        };
        if is_hop_by_hop(&name) {
            continue;
        }
        let Ok(value) = HeaderValue::from_bytes(value.as_bytes()) else {
            continue;
        };
        headers.append(name, value);
    }
    // Proxies and browsers both buffer `text/event-stream` unless told not
    // to, and a buffered stream is the failure this whole module is written
    // to avoid. Harmless on every other content type.
    headers.insert("x-accel-buffering", HeaderValue::from_static("no"));
    headers
}

/// Moves the upstream body into the channel, chunk by chunk, until it ends.
///
/// A transport failure part-way is sent as an error rather than dropped: the
/// body then ends in a way the client can see, instead of looking like a
/// response that simply finished. Revocation stops the pump the same way —
/// [`end_revoked`] — because a removed device's stream must read as a
/// failure, not as a turn that completed.
///
/// The revocation signal is selected against both the waits this pump can
/// sit in: waiting for the next chunk, and waiting for the device to take a
/// chunk it has stopped reading. A device removed while it is mid-stream ends
/// now, whichever of those it was doing.
async fn pump(
    mut upstream: reqwest::Response,
    sender: mpsc::Sender<super::body::Chunk>,
    token: String,
    mut revoked: watch::Receiver<bool>,
) {
    // Removed between the gate's validation and this spawn: the response
    // headers are already on their way, so the body is made to fail rather
    // than to carry on.
    if *revoked.borrow_and_update() {
        end_revoked(&sender).await;
        return;
    }
    loop {
        let chunk = tokio::select! {
            // `biased` puts revocation first when both arms are ready: a
            // removed device's next chunk is not delivered on a coin flip.
            changed = revoked.changed() => {
                if changed.is_err() {
                    // Every sender is gone — the device store itself is being
                    // torn down, which happens as the process ends.
                    return;
                }
                // The channel is one-way (`devices.rs` sends only `true`),
                // so an observed change is a revocation.
                end_revoked(&sender).await;
                return;
            }
            chunk = upstream.chunk() => chunk,
        };
        match chunk {
            Ok(Some(bytes)) => {
                // A send failure means the device hung up. Stopping here also
                // drops the upstream response, which closes the connection to
                // the harness — so a reader that goes away does not leave a
                // stream running behind it.
                let sent = tokio::select! {
                    // The send is inside the select too, so a device that
                    // stops reading cannot hold its upstream open past its
                    // own removal either. A cancelled send drops that chunk;
                    // the body is failing immediately after, so nothing
                    // downstream ever counts on it.
                    changed = revoked.changed() => {
                        // One-way channel: an observed change is a
                        // revocation; an error is the store being torn down
                        // with the process.
                        if changed.is_ok() {
                            end_revoked(&sender).await;
                        }
                        return;
                    }
                    sent = sender.send(Ok(bytes)) => sent,
                };
                if sent.is_err() {
                    return;
                }
            }
            Ok(None) => return,
            Err(error) => {
                let _ = sender
                    .send(Err(std::io::Error::other(redact(&error.to_string(), &token))))
                    .await;
                return;
            }
        }
    }
}

/// Ends a revoked device's body the way a transport failure ends it: with an
/// error the reader can see. Returning without this would let the channel
/// close quietly and hyper write a normal terminating chunk — the device
/// would read its own removal as a turn that simply finished, and would have
/// no reason to ask again and learn it is no longer paired.
async fn end_revoked(sender: &mpsc::Sender<super::body::Chunk>) {
    let _ = sender
        .send(Err(std::io::Error::other("This device was removed from Studio.")))
        .await;
}

/// Whether a path is one the harness owns rather than one the frontend does.
pub(crate) fn is_harness_path(path: &str) -> bool {
    path == "/api"
        || path == "/agents"
        || path.starts_with("/api/")
        || path.starts_with("/agents/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harness_paths_are_the_two_prefixes_and_nothing_that_merely_starts_like_them() {
        assert!(is_harness_path("/api/conversations"));
        assert!(is_harness_path("/agents/studio/cnv_1"));
        assert!(is_harness_path("/api"));
        // The frontend's own files. `/apiary.js` starting with "/api" is
        // exactly the reason the test is for a path segment and not a prefix.
        assert!(!is_harness_path("/apiary.js"));
        assert!(!is_harness_path("/agents-of-change.css"));
        assert!(!is_harness_path("/"));
        assert!(!is_harness_path("/assets/index.js"));
    }

    #[test]
    fn hop_by_hop_headers_are_recognised_case_insensitively() {
        // `HeaderName` lowercases on construction, which is what makes the
        // straight string comparison in `is_hop_by_hop` correct.
        assert!(is_hop_by_hop(&HeaderName::from_static("transfer-encoding")));
        assert!(is_hop_by_hop(
            &HeaderName::from_bytes(b"Transfer-Encoding").unwrap()
        ));
        assert!(is_hop_by_hop(&HeaderName::from_static("content-length")));
        assert!(!is_hop_by_hop(&HeaderName::from_static("content-type")));
    }

    #[test]
    fn upstream_connection_headers_do_not_reach_the_device() {
        let mut upstream = reqwest::header::HeaderMap::new();
        upstream.insert("content-type", HeaderValue::from_static("application/json"));
        upstream.insert("content-length", HeaderValue::from_static("42"));
        upstream.insert("transfer-encoding", HeaderValue::from_static("chunked"));
        upstream.insert("cache-control", HeaderValue::from_static("no-store"));

        let forwarded = forwarded_headers(&upstream);

        assert_eq!(
            forwarded.get("content-type").unwrap(),
            "application/json"
        );
        assert_eq!(forwarded.get("cache-control").unwrap(), "no-store");
        // This hop re-frames the body, so the upstream's framing would be a
        // lie about this connection.
        assert!(forwarded.get("content-length").is_none());
        assert!(forwarded.get("transfer-encoding").is_none());
        assert_eq!(forwarded.get("x-accel-buffering").unwrap(), "no");
    }

    /// A request with no body.
    ///
    /// `is_long_lived` reads only the URI and the headers, and it is generic
    /// over the body for exactly this reason: hyper's `Incoming` has no
    /// public constructor, so a test that needed one could not be written at
    /// all. Being generic costs nothing at the call site and makes the rule
    /// testable on its own.
    fn request_with(uri: &str, accept: Option<&str>) -> Request<()> {
        let mut builder = Request::builder().uri(uri);
        if let Some(accept) = accept {
            builder = builder.header(hyper::header::ACCEPT, accept);
        }
        builder.body(()).unwrap()
    }

    /// A stand-in for the harness: a real HTTP server on a real loopback
    /// socket.
    ///
    /// Worth the twenty lines rather than mocking reqwest, because the things
    /// most likely to be wrong here are wire-level - whether the bearer is
    /// actually on the request, whether a chunk actually leaves before the
    /// response ends - and a mock would answer those questions with whatever
    /// this file already believes.
    /// The blank line that ends a request's headers.
    ///
    /// Named rather than written inline at the comparison, because an HTTP
    /// message is one of the few places where the difference between a real
    /// line break and the two characters `\r\n` decides whether anything works
    /// at all - and inline, that difference is invisible when reading the
    /// code.
    const HEADER_END: &[u8; 4] = b"\r\n\r\n";

    struct StandInHarness {
        url: String,
        /// What the last request carried, so the test can check what crossed.
        seen: std::sync::Arc<std::sync::Mutex<Vec<(String, String)>>>,
    }

    async fn stand_in(streaming: bool) -> StandInHarness {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let recorded = seen.clone();

        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            // Read until the end of the headers; the tests send no body.
            loop {
                let read = socket.read(&mut buffer).await.unwrap();
                request.extend_from_slice(&buffer[..read]);
                if read == 0 || request.windows(4).any(|window| window == HEADER_END) {
                    break;
                }
            }
            let text = String::from_utf8_lossy(&request).into_owned();
            let mut headers = Vec::new();
            for line in text.lines().skip(1) {
                if line.is_empty() {
                    break;
                }
                if let Some((name, value)) = line.split_once(':') {
                    headers.push((name.trim().to_lowercase(), value.trim().to_owned()));
                }
            }
            *recorded.lock().unwrap() = headers;

            if streaming {
                socket
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n",
                    )
                    .await
                    .unwrap();
                socket.write_all(b"5\r\nfirst\r\n").await.unwrap();
                socket.flush().await.unwrap();
                // The gap is the point: a hop that buffers would deliver both
                // chunks together at the end, and the test below would see the
                // first one only after the second was written.
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                socket.write_all(b"6\r\nsecond\r\n").await.unwrap();
                socket.write_all(b"0\r\n\r\n").await.unwrap();
            } else {
                socket
                    .write_all(
                        b"HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: 32\r\n\r\n{\"error\":\"No such conversation\"}",
                    )
                    .await
                    .unwrap();
            }
            let _ = socket.flush().await;
        });

        StandInHarness { url, seen }
    }

    /// A stand-in that reads a whole request, body included, and answers
    /// with what it saw: the body's length in the response body, and its
    /// headers recorded like `stand_in`'s.
    ///
    /// Every message a device sends is a POST with a JSON body, and nothing
    /// above exercised that path: the two stand-ins read up to the header
    /// end and stop. A body that never reached the harness, or reached it
    /// re-framed wrongly, would have been invisible to this file.
    async fn stand_in_reading_bodies() -> StandInHarness {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let recorded = seen.clone();

        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            let header_end = loop {
                let read = socket.read(&mut buffer).await.unwrap();
                request.extend_from_slice(&buffer[..read]);
                if let Some(at) = request.windows(4).position(|window| window == HEADER_END) {
                    break at + 4;
                }
                if read == 0 {
                    break request.len();
                }
            };
            let head = String::from_utf8_lossy(&request[..header_end]).into_owned();
            let mut headers = Vec::new();
            let mut length = 0_usize;
            for line in head.lines().skip(1) {
                if line.is_empty() {
                    break;
                }
                if let Some((name, value)) = line.split_once(':') {
                    let name = name.trim().to_lowercase();
                    let value = value.trim().to_owned();
                    if name == "content-length" {
                        length = value.parse().unwrap_or(0);
                    }
                    headers.push((name, value));
                }
            }
            while request.len() < header_end + length {
                let read = socket.read(&mut buffer).await.unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
            }
            let body = String::from_utf8_lossy(&request[header_end..]).into_owned();
            headers.push(("<body>".to_owned(), body));
            *recorded.lock().unwrap() = headers;

            let answer = format!("{{\"received\":{length}}}");
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: {}

{answer}",
                        answer.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            let _ = socket.flush().await;
        });

        StandInHarness { url, seen }
    }

    #[tokio::test]
    async fn a_message_body_reaches_the_harness_whole_with_its_content_type() {
        use http_body_util::BodyExt;

        let harness = stand_in_reading_bodies().await;
        let upstream = Upstream {
            url: harness.url.clone(),
            token: "bearer".to_owned(),
        };
        let (_revoke, revoked) = live_device();

        let json = r#"{"kind":"user","body":"hello from a phone","reasoningLevel":null}"#;
        let request = Request::builder()
            .method("POST")
            .uri("/agents/studio/cnv_1")
            .header(hyper::header::ACCEPT, "application/json")
            .header(hyper::header::CONTENT_TYPE, "application/json")
            .body(http_body_util::Full::new(bytes::Bytes::from(json)))
            .unwrap();

        let response = forward(&upstream, request, revoked).await;
        assert_eq!(response.status(), StatusCode::OK);
        let answered = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(answered, bytes::Bytes::from(format!("{{\"received\":{}}}", json.len())));

        let seen = harness.seen.lock().unwrap().clone();
        let find = |name: &str| {
            seen.iter()
                .find(|(seen_name, _)| seen_name == name)
                .map(|(_, value)| value.clone())
        };
        assert_eq!(find("content-type").as_deref(), Some("application/json"));
        assert_eq!(find("content-length").as_deref(), Some(json.len().to_string().as_str()));
        assert_eq!(find("<body>").as_deref(), Some(json));
    }

    /// How long a chunk may take before the test calls it a hang.
    ///
    /// Comfortably longer than the stand-in's own 150ms pause and far shorter
    /// than a person's patience for a stuck suite.
    const CHUNK_DEADLINE: std::time::Duration = std::time::Duration::from_secs(5);

    /// The next chunk of a body, or a failure saying it never came.
    async fn next_chunk(body: &mut RemoteBody) -> bytes::Bytes {
        use http_body_util::BodyExt;
        tokio::time::timeout(CHUNK_DEADLINE, body.frame())
            .await
            .expect("waited for a chunk that never arrived")
            .expect("the body ended before the chunk arrived")
            .expect("the body failed instead of carrying a chunk")
            .into_data()
            .expect("the frame carried no data")
    }

    fn get(uri: &str, device_authorization: Option<&str>) -> Request<http_body_util::Empty<bytes::Bytes>> {
        let mut builder = Request::builder().uri(uri);
        if let Some(value) = device_authorization {
            builder = builder.header(hyper::header::AUTHORIZATION, value);
        }
        builder.body(http_body_util::Empty::new()).unwrap()
    }

    /// A revocation signal that never fires, for the tests whose device stays
    /// paired. The sender half is kept alive by the test: a dropped sender
    /// reads to the pump as the device store being torn down, which would end
    /// every body immediately.
    fn live_device() -> (watch::Sender<bool>, watch::Receiver<bool>) {
        tokio::sync::watch::channel(false)
    }

    #[tokio::test]
    async fn the_harness_bearer_is_attached_and_the_device_never_supplies_one() {
        let harness = stand_in(false).await;
        let upstream = Upstream {
            url: harness.url.clone(),
            token: "the-per-launch-bearer".to_owned(),
        };
        let (_revoke, revoked) = live_device();

        // The device sends a credential of its own. It must not reach the
        // harness: this seam owns `Authorization`, and letting a device's
        // value through would send it in place of the bearer.
        let mut request = get("/api/conversations", Some("Bearer i-made-this-up"));
        request.headers_mut().insert("x-project-studio-device-id", HeaderValue::from_static("pd_forged"));
        request.extensions_mut().insert(PairedSource("pd_verified".to_owned()));
        let response = forward(&upstream, request, revoked)
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let seen = harness.seen.lock().unwrap().clone();
        let authorization: Vec<_> = seen
            .iter()
            .filter(|(name, _)| name == "authorization")
            .map(|(_, value)| value.clone())
            .collect();
        assert_eq!(authorization, vec!["Bearer the-per-launch-bearer".to_owned()]);
        let source: Vec<_> = seen.iter().filter(|(name, _)| name == "x-project-studio-device-id")
            .map(|(_, value)| value.as_str()).collect();
        assert_eq!(source, vec!["pd_verified"]);
    }

    #[tokio::test]
    async fn a_stream_reaches_the_device_a_chunk_at_a_time_rather_than_all_at_the_end() {
        use http_body_util::BodyExt;

        let harness = stand_in(true).await;
        let upstream = Upstream {
            url: harness.url.clone(),
            token: "bearer".to_owned(),
        };
        let (_revoke, revoked) = live_device();

        let started = std::time::Instant::now();
        let response = forward(
            &upstream,
            get("/agents/studio/cnv_1?offset=0&live=sse", None),
            revoked,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        // Buffering is what this proxy exists not to do, and a browser or an
        // intermediary will buffer an event stream unless told not to.
        assert_eq!(response.headers().get("x-accel-buffering").unwrap(), "no");

        let mut body = response.into_body();
        // Bounded rather than a bare await. A body whose pump never runs waits
        // for chunks forever, and a test that hangs says far less than one
        // that fails - this is exactly how the `tauri::async_runtime::spawn`
        // mistake first showed up, as a run that never ended.
        let first = next_chunk(&mut body).await;
        let after_first = started.elapsed();
        assert_eq!(first, bytes::Bytes::from("first"));
        // The stand-in waits 150ms before the second chunk. Arriving well
        // inside that window is the proof that the first chunk was forwarded
        // as it came rather than held until the response was complete.
        assert!(
            after_first < std::time::Duration::from_millis(120),
            "the first chunk took {after_first:?}, which means the hop buffered it"
        );

        let second = next_chunk(&mut body).await;
        assert_eq!(second, bytes::Bytes::from("second"));
        assert!(
            tokio::time::timeout(CHUNK_DEADLINE, body.frame())
                .await
                .expect("the body never ended")
                .is_none()
        );
    }

    #[tokio::test]
    async fn diagnostics_never_leave_the_local_host() {
        let upstream = Upstream { url: "http://127.0.0.1:1".to_owned(), token: "bearer".to_owned() };
        let (_revoke, revoked) = live_device();
        for path in ["/api/diagnostics", "/api/diagnostics/events", "/api/%64iagnostics/policy", "/api/x/../diagnostics/events",
            "/api/observations/native", "/api/observations/%6eative/", "/api/observations/x/../native"] {
            let response = forward(&upstream, get(path, None), revoked.clone()).await;
            assert_eq!(response.status(), StatusCode::FORBIDDEN, "{path}");
        }
    }

    #[tokio::test]
    async fn stopping_the_harness_is_refused_however_the_path_is_spelled() {
        // The listener answers devices on a network. The webview's seam
        // already refuses this route; a device must not be the way around it.
        let upstream = Upstream {
            url: "http://127.0.0.1:1".to_owned(),
            token: "bearer".to_owned(),
        };
        let (_revoke, revoked) = live_device();
        for path in ["/api/shutdown", "/api/x/../shutdown", "/api/%73hutdown"] {
            let response = forward(&upstream, get(path, None), revoked.clone()).await;
            assert_eq!(
                response.status(),
                StatusCode::BAD_REQUEST,
                "{path} should have been refused before it was sent anywhere"
            );
        }
    }

    #[tokio::test]
    async fn removing_the_device_ends_its_stream_as_a_failure_mid_read() {
        use http_body_util::BodyExt;

        let harness = stand_in(true).await;
        let upstream = Upstream {
            url: harness.url.clone(),
            token: "bearer".to_owned(),
        };
        let (revoke, revoked) = live_device();

        let response = forward(
            &upstream,
            get("/agents/studio/cnv_1?offset=0&live=sse", None),
            revoked,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let mut body = response.into_body();
        assert_eq!(next_chunk(&mut body).await, bytes::Bytes::from("first"));

        // The device is removed while it is mid-read — the stand-in's second
        // chunk is still 150ms away, so revocation is what the pump sees.
        let _ = revoke.send(true);

        // The body ends as a failure, not as a stream that quietly finished:
        // a removed device must learn that something happened, and its next
        // request is where it finds out it is no longer paired.
        let frame = tokio::time::timeout(CHUNK_DEADLINE, body.frame())
            .await
            .expect("the body never ended after revocation");
        let error = frame
            .expect("the body ended without reporting the removal")
            .unwrap_err();
        assert!(error.to_string().contains("removed from Studio"));
    }

    #[test]
    fn a_stream_is_recognised_from_either_convention() {
        assert!(is_long_lived(&request_with(
            "/agents/studio/cnv_1?offset=8&live=sse",
            None
        )));
        assert!(is_long_lived(&request_with(
            "/agents/studio/cnv_1",
            Some("text/event-stream")
        )));
        assert!(!is_long_lived(&request_with(
            "/api/conversations",
            Some("application/json")
        )));
        assert!(!is_long_lived(&request_with("/api/conversations", None)));
    }
}
