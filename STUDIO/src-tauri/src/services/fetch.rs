//! `service_fetch`: one request, one response, nothing held in between.

use std::time::Duration;

use serde::Serialize;

use crate::harness::supervisor::{HarnessSupervisor, redact};

use super::error::request_failure;
use super::{apply_init, method_from_init, seam_client, validate_path, ServiceError, ServiceId, ServiceRequestInit};

/// A bound on a request whose caller has already given up.
///
/// The webview aborts at its own per-call timeout, but a Tauri invoke cannot
/// be cancelled from JS: the command keeps running after the promise is
/// abandoned. Without a timeout of our own, a wedged harness would hold the
/// connection open forever.
///
/// The number is the largest budget any caller of this seam sets, plus
/// headroom - the media routes (`/api/media/speech`, `/api/media/transcribe`)
/// give read-aloud and dictation 150s because a provider may legitimately
/// need them for a long passage. A seam timeout at or below a caller's budget
/// would cut that caller off mid-flight and show its own words as the
/// failure, which is why this is 165s and not less. Every other caller sets
/// a shorter budget of its own (the client's 12s default, the probe's 12s),
/// so the timeout the user sees stays the JS one, with its proper words.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(165);

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

/// The one arm. Everything about reaching the Harness is decided by the
/// supervisor rather than the caller — the address above all, and with it
/// the credential: read here, at call time, held only for this request,
/// returned to no one.
async fn harness_fetch(
    supervisor: &HarnessSupervisor,
    path: &str,
    init: ServiceRequestInit,
) -> Result<SerializedResponse, ServiceError> {
    validate_path(path)?;

    let endpoint = supervisor.get_endpoint().ok_or(ServiceError::NotRunning)?;

    let method = method_from_init(&init)?;

    let client = seam_client()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| request_failure(&endpoint.token, error))?;

    let request = apply_init(
        client.request(method, format!("{}{}", endpoint.url, path)),
        &endpoint,
        init,
    );

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

/// Reads one attachment's bytes through the same seam [`service_fetch`]
/// walks.
///
/// The attachment route answers with the raw bytes of a screenshot frame, and
/// [`harness_fetch`]'s `response.text()` would decode them as lossy UTF-8 —
/// corruption no far side can undo. So this command exists beside it: a plain
/// GET (an attachment read carries no body and no caller headers worth
/// keeping), the same path validation and supervisor-held bearer, and the
/// body crossing the invoke boundary as raw bytes rather than text.
///
/// Success is a `tauri::ipc::Response`, which the webview's `invoke` resolves
/// to an `ArrayBuffer`. A refusal is `ServiceError::Refused`, so the reader
/// keeps one vocabulary — bytes or a reason — and can tell a stale credential
/// (401) from an attachment the conversation does not hold (404).
pub async fn service_fetch_bytes(
    supervisor: &HarnessSupervisor,
    service: ServiceId,
    path: String,
) -> Result<tauri::ipc::Response, ServiceError> {
    match service {
        ServiceId::Harness => {
            validate_path(&path)?;
            let endpoint = supervisor.get_endpoint().ok_or(ServiceError::NotRunning)?;
            let client = seam_client()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .map_err(|error| request_failure(&endpoint.token, error))?;
            let request = client
                .get(format!("{}{}", endpoint.url, path))
                .bearer_auth(&endpoint.token)
                .build()
                .map_err(|error| ServiceError::InvalidRequest {
                    message: error.to_string(),
                })?;
            let response = client
                .execute(request)
                .await
                .map_err(|error| request_failure(&endpoint.token, error))?;

            let status = response.status();
            if !status.is_success() {
                // The harness writes its refusals as JSON with an `error`
                // sentence; that sentence is better than any this side could
                // compose, so it is read and carried, redacted like every
                // other string that could in principle echo the bearer.
                let body = response.text().await.unwrap_or_default();
                let message = serde_json::from_str::<serde_json::Value>(&body)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("error")?
                            .as_str()
                            .map(str::to_owned)
                    })
                    .unwrap_or_else(|| format!("the harness answered {status} with no explanation."));
                return Err(ServiceError::Refused {
                    status: status.as_u16(),
                    message: redact(&message, &endpoint.token),
                });
            }

            let bytes = response
                .bytes()
                .await
                .map_err(|error| request_failure(&endpoint.token, error))?;
            Ok(tauri::ipc::Response::new(bytes.to_vec()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::harness::test_support::ONE_HARNESS_AT_A_TIME;

    /// The seam must outlive every caller's own budget, or it becomes the
    /// failure the caller never sees coming: the media client gives read-aloud
    /// and dictation 150s (`STUDIO/src/platform/harness/client/media.ts`),
    /// and a slower cut of the same request would surface here as a dead
    /// seam instead of the provider's answer.
    #[test]
    fn the_seam_timeout_clears_the_largest_caller_budget() {
        assert!(REQUEST_TIMEOUT >= Duration::from_secs(150));
    }

    /// Shuts the Harness down even when an assertion between start and stop
    /// panics, so a failure does not leak a Node process holding a loopback
    /// port into the next test run.
    struct StopOnDrop(HarnessSupervisor);

    impl Drop for StopOnDrop {
        fn drop(&mut self) {
            self.0.shutdown_all();
        }
    }

    /// The seam itself, end to end: a request carrying no credential of its
    /// own reaches a harness Rust started, admitted by the bearer Rust holds.
    ///
    /// Requires `dist/server.mjs`; `pnpm build` in `STUDIO HARNESS/` writes
    /// it. Same constraint as `harness/integration.rs`.
    #[tokio::test]
    async fn service_fetch_answers_through_the_credential_rust_holds() {
        let _serial = ONE_HARNESS_AT_A_TIME.lock().await;
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
    /// exists, and a service that is not running. The third — a transport
    /// failure — scrubs in `request_failure` and is tested above.
    #[tokio::test]
    async fn no_error_a_live_harness_produces_contains_its_token() {
        let _serial = ONE_HARNESS_AT_A_TIME.lock().await;
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

    /// A refusal on the byte seam is the `Refused` error, carrying the
    /// harness's own sentence, with the bearer in nothing.
    ///
    /// The success path needs a conversation holding a real attachment, which
    /// only a run can create; the refusal path needs only a harness, and it
    /// exercises everything the success path shares — validation, the
    /// endpoint, the bearer, the status branch. The bytes themselves cross
    /// Tauri's raw IPC response and touch no decode on either side, which is
    /// the property the command exists for.
    #[tokio::test]
    async fn a_byte_refusal_carries_the_harness_sentence_and_not_the_token() {
        let _serial = ONE_HARNESS_AT_A_TIME.lock().await;
        let supervisor = HarnessSupervisor::new();
        let endpoint = match supervisor.start() {
            Ok(endpoint) => endpoint,
            Err(error) => panic!("the harness did not start: {error}"),
        };
        let _stop = StopOnDrop(supervisor.clone());
        let token = endpoint.token.clone();

        let outcome = service_fetch_bytes(
            &supervisor,
            ServiceId::Harness,
            "/agents/studio/no-such-conversation/attachments/att_none".to_owned(),
        )
        .await;
        // `unwrap_err` needs the Ok side to be `Debug`, and a raw IPC response
        // is not; the match reads the same refusal without asking it to print.
        let error = match outcome {
            Err(error) => error,
            Ok(_) => panic!("an attachment nobody stored answered success"),
        };

        let ServiceError::Refused { status, message } = error else {
            panic!("expected a Refused error");
        };
        assert_eq!(status, 404, "a conversation nobody spoke into does not exist");
        assert!(!message.is_empty(), "the harness's sentence should have been read");
        let text = serde_json::to_string(&ServiceError::Refused { status, message })
            .expect("errors serialize");
        assert!(!text.contains(&token), "the bearer appeared in an error: {text}");
    }
}
