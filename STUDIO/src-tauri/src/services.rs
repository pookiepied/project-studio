//! The one seam through which the webview reaches a side system.
//!
//! There is exactly one side system today -- the Harness -- and that is why
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
//! needs it -- `service_fetch` reads it from the supervisor at call time,
//! attaches it, and scrubs it from anything that could echo it.

use std::fmt::Display;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::harness::supervisor::{redact, HarnessSupervisor};

/// A bound on a request whose caller has already given up.
///
/// The webview aborts at its own 12s timeout, but a Tauri invoke cannot be
/// cancelled from JS: the command keeps running after the promise is
/// abandoned. Without a timeout of our own, a wedged harness would hold the
/// connection open forever. 30s is deliberately longer than the webview's
/// 12s, so the timeout the user sees is the JS one, with its proper words.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// The side systems the webview may ask Rust to call on its behalf.
///
/// An enum rather than a string so that an unknown service is a
/// deserialization failure at the invoke boundary -- the request never runs,
/// and the error says what was not recognised -- rather than a runtime string
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

/// A response, flattened into the one shape that crosses the invoke boundary.
///
/// The JS side of the seam rebuilds a `Response` from this. The body is text
/// because every harness route speaks JSON.
#[derive(Debug, Serialize)]
pub struct SerializedResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

/// How a `service_fetch` call fails.
///
/// `NotRunning` is separate from `Request` on purpose: it is the difference
/// between the UI being able to say "the harness is not started" and having
/// to say "the request failed".
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ServiceError {
    NotRunning,
    InvalidPath { message: String },
    InvalidRequest { message: String },
    Request { message: String },
}

/// A path, never a URL.
///
/// The final address is `endpoint.url + path`, parsed as a URL afterwards, so
/// these checks are exactly the ones that keep `path` inside the path
/// component of that URL:
///
/// - it must start with `/`, because the authority of a URL ends at its
///   first `/`. A path like `@example.com/x` concatenated onto the base
///   re-parses with `example.com` as the host and the base as userinfo --
///   which is a credentialed request to somebody else's server;
/// - it must not start with `//`, which is how a protocol-relative URL names
///   an authority;
/// - it must not contain `://`, the scheme separator.
///
/// Everything else -- `?`, `#`, percents, non-ASCII -- is inert once the
/// first character is `/`: the authority has already ended, and nothing that
/// follows it can reopen one.
fn validate_path(path: &str) -> Result<(), ServiceError> {
    let reason = if path.is_empty() {
        "the path is empty"
    } else if !path.starts_with('/') {
        "it does not start with '/', and anything else re-parses as userinfo against the base URL"
    } else if path.starts_with("//") {
        "a path starting '//' names an authority"
    } else if path.contains("://") {
        "it contains a scheme"
    } else {
        return Ok(());
    };
    Err(ServiceError::InvalidPath {
        message: format!("service_fetch takes a path, not a URL: {reason}"),
    })
}

/// The one shape a transport failure takes, so the bearer can be scrubbed in
/// exactly one place.
///
/// reqwest's error text includes the URL but not the headers, so the token
/// has no natural way in. This exists so that if it ever finds one, it dies
/// here rather than in a bug report.
fn request_failure(token: &str, error: impl Display) -> ServiceError {
    ServiceError::Request {
        message: redact(&error.to_string(), token),
    }
}

/// The one arm. Everything about reaching the Harness is decided by the
/// supervisor rather than the caller -- the address above all, and with it
/// the credential: read here, at call time, held only for this request,
/// returned to no one.
async fn harness_fetch(
    supervisor: &HarnessSupervisor,
    path: &str,
    init: ServiceRequestInit,
) -> Result<SerializedResponse, ServiceError> {
    validate_path(path)?;

    let endpoint = supervisor.get_endpoint().ok_or(ServiceError::NotRunning)?;

    let method = reqwest::Method::from_bytes(
        init.method.unwrap_or_else(|| "GET".to_owned()).as_bytes(),
    )
    .map_err(|error| ServiceError::InvalidRequest {
        message: format!("the method is not a valid HTTP token: {error}"),
    })?;

    // No redirects are followed, on purpose. The credential is attached
    // below, and following a redirect would mean deciding whether a 3xx to
    // another origin still gets it. `Policy::none` makes that decision once,
    // here: a 3xx is returned as the response it is, and the bearer
    // physically cannot arrive at any origin but the one the supervisor
    // resolved.
    //
    // No TLS is linked in either (`default-features = false` in Cargo.toml):
    // this client exists to talk to one loopback http address, and a scheme
    // it cannot speak is one more thing it cannot be steered into.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| request_failure(&endpoint.token, error))?;

    let mut request = client
        .request(method, format!("{}{}", endpoint.url, path))
        .bearer_auth(&endpoint.token);

    // The caller's headers ride along, except the one this arm owns. The
    // client sets `Authorization` from the placeholder the connection layer
    // uses to mean "Rust attaches the real one" (see `connection.ts`); letting
    // it through would send that placeholder to the harness instead of the
    // bearer the harness expects.
    for (name, value) in init.headers.unwrap_or_default() {
        if name.eq_ignore_ascii_case("authorization") {
            continue;
        }
        request = request.header(name, value);
    }
    if let Some(body) = init.body {
        request = request.body(body);
    }

    let request = request.build().map_err(|error| ServiceError::InvalidRequest {
        message: error.to_string(),
    })?;

    let response = client
        .execute(request)
        .await
        .map_err(|error| request_failure(&endpoint.token, error))?;

    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_owned(),
                String::from_utf8_lossy(value.as_bytes()).into_owned(),
            )
        })
        .collect();
    let body = response
        .text()
        .await
        .map_err(|error| request_failure(&endpoint.token, error))?;

    Ok(SerializedResponse { status, headers, body })
}

/// Issues one request to a named side system and hands back the response.
///
/// Split from the `#[tauri::command]` wrapper in `lib.rs` so the behaviour is
/// testable without a Tauri app: the wrapper does nothing but pass the
/// supervisor state through.
pub async fn service_fetch(
    supervisor: &HarnessSupervisor,
    service: ServiceId,
    path: String,
    init: ServiceRequestInit,
) -> Result<SerializedResponse, ServiceError> {
    match service {
        ServiceId::Harness => harness_fetch(supervisor, &path, init).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::harness::test_support::ONE_HARNESS_AT_A_TIME;

    /// Shuts the Harness down even when an assertion between start and stop
    /// panics, so a failure does not leak a Node process holding a loopback
    /// port into the next test run.
    struct StopOnDrop(HarnessSupervisor);

    impl Drop for StopOnDrop {
        fn drop(&mut self) {
            self.0.shutdown_all();
        }
    }

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
    fn an_unknown_service_is_refused_at_deserialization_not_at_runtime() {
        // The invoke boundary is where an unknown name must die: no code of
        // ours runs with a service id it does not know.
        assert!(serde_json::from_value::<ServiceId>(serde_json::json!("account-backend")).is_err());
        assert_eq!(
            serde_json::from_value::<ServiceId>(serde_json::json!("harness")).unwrap(),
            ServiceId::Harness
        );
    }

    #[test]
    fn a_transport_failure_scrubs_the_bearer_before_it_becomes_text() {
        let message = request_failure(
            "known-token-value",
            std::io::Error::other("connect failed (token: known-token-value)"),
        );
        let ServiceError::Request { message } = message else {
            panic!("expected a Request error");
        };
        assert!(!message.contains("known-token-value"));
        assert!(message.contains("[redacted]"));
    }

    /// The seam itself, end to end: a request carrying no credential of its
    /// own reaches a harness Rust started, admitted by the bearer Rust holds.
    ///
    /// Requires `dist/server.mjs`; `pnpm build` in `STUDIO HARNESS/` writes
    /// it. Same constraint as `harness/integration.rs`.
    #[tokio::test]
    async fn service_fetch_answers_through_the_credential_rust_holds() {
        let _serial = ONE_HARNESS_AT_A_TIME.lock().unwrap();
        let supervisor = HarnessSupervisor::new();
        let endpoint = match supervisor.start() {
            Ok(endpoint) => endpoint,
            Err(error) => panic!("the harness did not start: {error}"),
        };
        let _stop = StopOnDrop(supervisor.clone());

        let response = service_fetch(
            &supervisor,
            ServiceId::Harness,
            "/api/mcp/servers".to_owned(),
            ServiceRequestInit::default(),
        )
        .await
        .expect("the request through the seam failed");

        assert_eq!(
            response.status, 200,
            "the harness refused the request Rust authenticated: {}",
            response.body
        );
        assert!(
            response.body.trim_start().starts_with('['),
            "expected the MCP server list, got: {}",
            response.body
        );
        assert_eq!(endpoint.host, "127.0.0.1");
    }

    /// No error the seam produces contains the bearer, asserted against a
    /// live one.
    ///
    /// The bearer only exists while the supervisor is running, so this is the
    /// one place the claim can be tested against the real value. Two error
    /// paths are drivable from outside: a path refused before any request
    /// exists, and a service that is not running. The third -- a transport
    /// failure -- scrubs in `request_failure` and is tested above.
    #[tokio::test]
    async fn no_error_a_live_harness_produces_contains_its_token() {
        let _serial = ONE_HARNESS_AT_A_TIME.lock().unwrap();
        let supervisor = HarnessSupervisor::new();
        let endpoint = match supervisor.start() {
            Ok(endpoint) => endpoint,
            Err(error) => panic!("the harness did not start: {error}"),
        };
        let _stop = StopOnDrop(supervisor.clone());
        let token = endpoint.token.clone();

        let invalid = service_fetch(
            &supervisor,
            ServiceId::Harness,
            "http://127.0.0.1:9/x".to_owned(),
            ServiceRequestInit::default(),
        )
        .await
        .unwrap_err();
        let text = serde_json::to_string(&invalid).expect("errors serialize");
        assert!(text.contains("invalid-path"), "{text}");
        assert!(!text.contains(&token), "the bearer appeared in an error: {text}");

        supervisor.shutdown_all();
        let not_running = service_fetch(
            &supervisor,
            ServiceId::Harness,
            "/api/mcp/servers".to_owned(),
            ServiceRequestInit::default(),
        )
        .await
        .unwrap_err();
        let text = serde_json::to_string(&not_running).expect("errors serialize");
        assert!(text.contains("not-running"), "{text}");
        assert!(!text.contains(&token), "the bearer appeared in an error: {text}");
    }
}
