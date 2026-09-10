//! The one seam through which the webview reaches a side system.
//!
//! There is exactly one side system today — the Harness — and that is why
//! this is an enum with one variant and a match with one arm, not a registry,
//! a trait-object table, or anything config-driven. The second side system
//! (an account backend) is v2 and a different shape entirely: no process, no
//! spawn, no readiness frame, no per-launch credential. Abstracting over
//! supervision from a sample of one would generalise in the wrong direction.
//! What this builds is a NAMED SEAM: calls carry a service id, and when a
//! second service arrives it is a second match arm with its own auth
//! strategy, and no call site changes.
//!
//! The credential rule this module exists to enforce: a credential never
//! crosses a boundary it does not have to. The webview does not know the
//! Harness bearer, cannot learn it (no command returns it), and no longer
//! needs it — `service_fetch` reads it from the supervisor at call time,
//! attaches it, and scrubs it from anything that could echo it.
//!
//! A directory rather than one file, mirroring `harness/`: `error.rs` holds
//! the failure shapes, `fetch.rs` the request-and-response command,
//! `stream.rs` the streaming command, `stream_control.rs` its in-session
//! cancellation, `sse.rs` the framing underneath it. The enum, the shared
//! `init` type and the path rule live here because every command through the
//! seam uses all three.

mod error;
mod fetch;
mod sse;
mod stream;
mod stream_control;

pub use error::ServiceError;
pub use fetch::{service_fetch, service_fetch_bytes, SerializedResponse};
pub use stream::service_stream;
pub use stream::StreamEvent;
pub(crate) use stream_control::StreamRegistry;

use serde::Deserialize;

use crate::harness::endpoint::HarnessEndpoint;

/// The side systems the webview may ask Rust to call on its behalf.
///
/// An enum rather than a string so that an unknown service is a
/// deserialization failure at the invoke boundary — the request never runs,
/// and the error says what was not recognised — rather than a runtime string
/// comparison that fails somewhere deeper with a worse message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceId {
    Harness,
}

/// The parts of a fetch `init` that mean anything on this side of the seam.
///
/// `signal` is honoured on the JS side (`transport.ts` races the invoke
/// against it, because only there can the abort be observed); `cache`, `mode`
/// and friends describe webview behaviour with no analogue in reqwest.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ServiceRequestInit {
    pub method: Option<String>,
    pub headers: Option<Vec<(String, String)>>,
    pub body: Option<String>,
}

/// A path, never a URL.
///
/// The final address is `endpoint.url + path`, parsed as a URL afterwards, so
/// these checks are exactly the ones that keep `path` inside the path
/// component of that URL:
///
/// - it must start with `/`, because the authority of a URL ends at its
///   first `/`. A path like `@example.com/x` concatenated onto the base
///   re-parses with `example.com` as the host and the base as userinfo —
///   which is a credentialed request to somebody else's server;
/// - it must not start with `//`, which is how a protocol-relative URL names
///   an authority;
/// - it must not contain `://`, the scheme separator.
///
/// Everything else — `?`, `#`, percents, non-ASCII — is inert once the
/// first character is `/`: the authority has already ended, and nothing that
/// follows it can reopen one.
pub(crate) fn validate_path(path: &str) -> Result<(), ServiceError> {
    let reason = if path.is_empty() {
        "the path is empty"
    } else if !path.starts_with('/') {
        "it does not start with '/', and anything else re-parses as userinfo against the base URL"
    } else if path.starts_with("//") {
        "a path starting '//' names an authority"
    } else if path.contains("://") {
        "it contains a scheme"
    } else if is_refused_route(path) {
        // The one route in the denylist and why it is this one: `/api/shutdown`
        // ends the harness process. The harness's own guard for that route is
        // the client type, and production mints exactly ONE credential, typed
        // `studio-host` (`app.ts` in STUDIO HARNESS) — precisely the client
        // type the route demands. So from inside the harness process, the
        // desktop UI and the Host are indistinguishable, and the route's own
        // check cannot keep the webview out; only this seam knows that a
        // request came from the webview rather than from Rust itself. Every
        // other `/api` route manages state the UI legitimately reads and
        // changes — connections, models, approvals — so there is nothing to
        // list beyond the path that stops the process other windows use.
        return Err(ServiceError::InvalidPath {
            message: "the service seam does not carry shutdown: stopping the harness is the host's decision, made on the process's own channels".to_owned(),
        });
    } else {
        return Ok(());
    };
    Err(ServiceError::InvalidPath {
        message: format!("the service seam takes a path, not a URL: {reason}"),
    })
}

/// Routes the webview may not reach through the seam, however validly formed
/// its path. Kept a function so the match site above stays readable and the
/// test below has one thing to enumerate.
fn refused_routes() -> &'static [&'static str] {
    &["/api/shutdown"]
}

/// Whether `path` reaches a refused route once everything between here and
/// the router has had its say.
///
/// A denylist has to compare what the ROUTER will match, not what the caller
/// typed, and two layers rewrite the path in between:
///
/// - the `url` crate, which reqwest parses the composed address with, removes
///   `.` and `..` segments per RFC 3986, so `/api/x/../shutdown` leaves this
///   process as `/api/shutdown`;
/// - Hono, on the harness side, percent-decodes each segment before matching
///   and resolves dot segments of its own, so `/api/%73hutdown` and
///   `/api/x/%2E%2E/shutdown` both reach the shutdown handler.
///
/// Both were verified against the real crate and the real router, not assumed.
/// So the comparison runs on a canonical form: decode per segment, then
/// resolve. Anything this refuses that the router would have missed —
/// `/api//shutdown`, say — is a path nothing legitimate sends, and refusing a
/// superset is the safe direction for a denylist.
fn is_refused_route(path: &str) -> bool {
    refused_routes().contains(&canonical_route(path).as_str())
}

/// The path as the harness's router will read it.
///
/// Decoding happens per segment, after the split on `/`, because that is what
/// Hono does: an encoded `%2F` inside a segment stays content and never
/// becomes a separator. Decoding the whole path first would invent separators
/// the router never sees, and could refuse a legitimate id that carries one.
fn canonical_route(path: &str) -> String {
    let addressed = path.split(['?', '#']).next().unwrap_or("");
    let mut resolved: Vec<String> = Vec::new();
    for segment in addressed.split('/') {
        let decoded = percent_decode_segment(segment);
        match decoded.as_str() {
            // An empty segment is a doubled slash, and `.` is here-ish:
            // neither addresses anything.
            "" | "." => {}
            ".." => {
                resolved.pop();
            }
            _ => resolved.push(decoded),
        }
    }
    format!("/{}", resolved.join("/"))
}

/// Percent-decodes one path segment, once.
///
/// Once, not to a fixed point: the router decodes a single pass, so `%2525`
/// is the literal `%25` to it and must be to us. A `%` that does not begin a
/// valid escape is content, which is also how every router treats it.
fn percent_decode_segment(segment: &str) -> String {
    let bytes = segment.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let escape = (bytes[index] == b'%' && index + 2 < bytes.len())
            .then(|| {
                let high = (bytes[index + 1] as char).to_digit(16)?;
                let low = (bytes[index + 2] as char).to_digit(16)?;
                u8::try_from(high * 16 + low).ok()
            })
            .flatten();
        match escape {
            Some(byte) => {
                out.push(byte);
                index += 3;
            }
            None => {
                out.push(bytes[index]);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The client shape every command through the seam uses.
///
/// No redirects are followed, on purpose. The credential is attached by
/// [`apply_init`], and following a redirect would mean deciding whether a 3xx
/// to another origin still gets it. `Policy::none` makes that decision once,
/// here: a 3xx is returned as the response it is, and the bearer physically
/// cannot arrive at any origin but the one the supervisor resolved.
///
/// No TLS is linked in either (`default-features = false` in Cargo.toml):
/// this client exists to talk to one loopback http address, and a scheme it
/// cannot speak is one more thing it cannot be steered into.
///
/// Timeouts are deliberately the caller's: `service_fetch` bounds the whole
/// request, `service_stream` must not (a healthy stream is long-lived by
/// design; see `stream.rs`).
pub(super) fn seam_client() -> reqwest::ClientBuilder {
    reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
}

/// The method the caller asked for, or GET.
pub(super) fn method_from_init(init: &ServiceRequestInit) -> Result<reqwest::Method, ServiceError> {
    reqwest::Method::from_bytes(init.method.clone().unwrap_or_else(|| "GET".to_owned()).as_bytes())
        .map_err(|error| ServiceError::InvalidRequest {
            message: format!("the method is not a valid HTTP token: {error}"),
        })
}

/// Applies the credential and the caller's init to a request.
///
/// The caller's headers ride along, except the one this seam owns. The
/// client sets `Authorization` from the placeholder the connection layer
/// uses to mean "Rust attaches the real one" (see `connection.ts`); letting
/// it through would send that placeholder to the harness instead of the
/// bearer the harness expects.
pub(super) fn apply_init(
    request: reqwest::RequestBuilder,
    endpoint: &HarnessEndpoint,
    init: ServiceRequestInit,
) -> reqwest::RequestBuilder {
    let mut request = request.bearer_auth(&endpoint.token);
    for (name, value) in init.headers.unwrap_or_default() {
        if name.eq_ignore_ascii_case("authorization") {
            continue;
        }
        request = request.header(name, value);
    }
    if let Some(body) = init.body {
        request = request.body(body);
    }
    request
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_that_could_leave_the_harness_origin_is_refused() {
        let attacks = [
            "http://127.0.0.1:9/api", // absolute URL
            "https://example.com/api", // absolute URL, other scheme
            "//example.com/api",     // protocol-relative: names an authority
            "@example.com/api",      // re-parses as userinfo@host
            "api/providers",         // relative; base+path re-parses
            "",                      // nothing
        ];
        for path in attacks {
            let accepted = validate_path(path).is_ok();
            assert!(
                !accepted,
                "service_fetch accepted a path that is not a path: {path}"
            );
        }
    }

    #[test]
    fn an_honest_path_is_accepted() {
        assert!(validate_path("/api/providers/connections").is_ok());
        assert!(validate_path("/api/providers/models?kind=anthropic").is_ok());
    }

    #[test]
    fn the_shutdown_route_is_refused_at_the_seam() {
        // Production has exactly one credential and it is typed studio-host,
        // so the harness's own client-type check on this route cannot tell
        // the webview from the Host. The seam can, and must.
        assert!(matches!(
            validate_path("/api/shutdown"),
            Err(ServiceError::InvalidPath { .. })
        ));
        assert!(matches!(
            validate_path("/api/shutdown?confirm=true"),
            Err(ServiceError::InvalidPath { .. })
        ));
        // Neighbours that only look like it stay open.
        assert!(validate_path("/api/shutdowns").is_ok());
        assert!(validate_path("/api/shutdown/status").is_ok());
    }

    #[test]
    fn a_path_that_only_becomes_the_shutdown_route_later_is_refused_too() {
        // An exact-string denylist does not hold, because the path is
        // rewritten twice after it leaves here. Each of these was confirmed
        // to reach the shutdown handler: the first two because the `url`
        // crate removes dot segments while reqwest parses the composed
        // address, the rest because Hono percent-decodes every segment and
        // resolves dot segments before it matches a route.
        for disguise in [
            "/api/x/../shutdown",
            "/api/./shutdown",
            "/api/%73hutdown",
            "/api/sh%75tdown",
            "/%61pi/shutdown",
            "/api/x/%2E%2E/shutdown",
            "/api//shutdown",
            "/api/x/../shutdown?confirm=true",
        ] {
            assert!(
                matches!(
                    validate_path(disguise),
                    Err(ServiceError::InvalidPath { .. })
                ),
                "the seam let a disguised shutdown through: {disguise}"
            );
        }
    }

    #[test]
    fn canonicalising_does_not_close_paths_the_app_legitimately_uses() {
        // The denylist refuses a superset on purpose, so the cost of that
        // choice is worth pinning: an encoded separator inside one segment is
        // content, not a path boundary, and a model id is exactly where that
        // shows up.
        for honest in [
            "/api/providers/connections",
            "/api/providers/models?kind=anthropic",
            "/api/providers/connections/abc/models/anthropic%2Fclaude-opus-4",
            "/agents/main/01H%2FX",
            "/api/shutdown-report",
        ] {
            assert!(
                validate_path(honest).is_ok(),
                "the seam refused an honest path: {honest}"
            );
        }
    }

    #[test]
    fn an_unknown_service_is_refused_at_deserialization_not_at_runtime() {
        // The invoke boundary is where an unknown name must die: no code of
        // ours runs with a service id it does not know.
        assert!(serde_json::from_value::<ServiceId>(serde_json::json!("account-backend")).is_err());
        assert_eq!(
            serde_json::from_value::<ServiceId>(serde_json::json!("harness")).unwrap(),
            ServiceId::Harness
        );
    }
}
