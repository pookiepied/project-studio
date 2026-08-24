//! How a call through the service seam fails.
//!
//! The shapes live together because they are one classification, not a bag:
//! every variant is reachable from a real failure, and the webview picks its
//! words from them.

use std::fmt::Display;

use serde::Serialize;

use crate::harness::supervisor::redact;

/// How a call through the service seam fails.
///
/// The shapes live together because they are one classification, not a bag:
/// every variant is reachable from a real failure, and the webview picks its
/// words from them.
///
/// For `service_stream` the classification matters more than for
/// `service_fetch`, because a stream can fail after it has begun. A caller
/// distinguishes three ends:
///
/// - **never started** -- `NotRunning` (no harness), `InvalidPath`,
///   `InvalidRequest`, `StreamRefused` (the server answered, but not with a
///   stream: unauthorized above all). Nothing happened; the words are
///   "could not start".
/// - **started and then broke** -- `StreamBroken`, or `Request` when the
///   transport failed before the first byte. Recoverable by reattaching at
///   the last delivered offset; the words are "lost the stream".
/// - **ended normally** -- not an error at all: `Ok(())`, preceded by an
///   `Ended` event on the channel. The words are "finished".
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ServiceError {
    NotRunning,
    InvalidPath { message: String },
    InvalidRequest { message: String },
    Request { message: String },
    /// The server answered, but with a refusal rather than a stream.
    ///
    /// A 401 lands here, and so does anything else that is not a 2xx with an
    /// `text/event-stream` body: the stream never began, which is what makes
    /// this unrecoverable-by-reattach rather than retry-shaped.
    StreamRefused { status: u16, message: String },
    /// The stream began and then failed mid-flight: transport error, read
    /// idle past the harness heartbeat cadence, or content that is not the
    /// protocol it promised.
    ///
    /// Recoverable by reattaching at the last offset a delivered event
    /// carried -- that offset is why every event has one.
    StreamBroken { message: String },
}

/// The one shape a transport failure takes, so the bearer can be scrubbed in
/// exactly one place.
///
/// reqwest's error text includes the URL but not the headers, so the token
/// has no natural way in. This exists so that if it ever finds one, it dies
/// here rather than in a bug report.
pub(crate) fn request_failure(token: &str, error: impl Display) -> ServiceError {
    ServiceError::Request {
        message: redact(&error.to_string(), token),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
