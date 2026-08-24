//! `service_stream`: one request whose answer arrives over time.
//!
//! ADR 0045 is the specification: a run outlives the window that started it,
//! so the desktop app re-reads a run at an offset rather than holding a
//! connection as the thing that keeps it alive. This command is the reading
//! half -- the Durable Streams reader at `GET /agents/:name/:id`, resumed
//! with `?offset=<x>&live=sse`, delivered to the webview over a channel as
//! it happens.
//!
//! The credential rule is ADR 0044's, unchanged: the address comes from the
//! supervisor, the bearer is attached here and spent on this request, the
//! webview names neither. `service_fetch` and `service_stream` differ in
//! shape but not in who holds the credential.
//!
//! Three decisions this module exists to hold:
//!
//! - **The offset is opaque.** Durable Streams offsets are strings
//!   (`-1`, or `seq_batch` pairs), not integers, and their meaning belongs
//!   to the store. Rust carries them end to end without interpreting them:
//!   the requested offset seeds what events report, and every `control`
//!   frame from the harness advances it. Resume is a replay from the last
//!   reported offset, never a skip past an unacknowledged event.
//! - **A stream is bounded by idleness, not by age.** The harness heartbeats
//!   every 15s with comment lines -- bytes that complete no frame -- so a
//!   read that stays silent past [`READ_IDLE_TIMEOUT`] is a dead or frozen
//!   server, while a healthy stream can run for hours. A total timeout,
//!   like `service_fetch`'s 30s, would make every long turn a failure.
//! - **A reader that vanishes must not hold a connection.** Tauri channels
//!   carry no notification from the webview to Rust; the only signal is a
//!   send failing, which it does once the webview was destroyed. Sending
//!   [`CHANNEL_HEARTBEAT`] regularly bounds how long an unread stream keeps
//!   its connection open to that discovery -- the backstop, bounded by
//!   idleness. The prompt path is deliberate: the webview names the stream
//!   when it starts it and cancels it through [`StreamRegistry`]
//!   (`stream_control.rs`) while the session is still alive, which is the
//!   routine case -- switching conversations, closing a pane -- and cannot
//!   wait fifteen seconds for a heartbeat to notice anything.

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio::sync::watch;

use crate::harness::endpoint::HarnessEndpoint;
use crate::harness::supervisor::{redact, HarnessSupervisor};

use super::error::request_failure;
use super::sse::{SseFrame, SseParser};
use super::stream_control::StreamRegistry;
use super::{
    apply_init, method_from_init, seam_client, validate_path, ServiceError, ServiceId,
    ServiceRequestInit,
};

/// How long the connection itself may take to establish.
///
/// The one phase of a stream that has no business being slow: the harness is
/// a loopback child the supervisor just spoke to. Everything after the
/// headers is bounded by [`READ_IDLE_TIMEOUT`] instead, because it is the
/// stream, not the request, that lives there.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// How long the stream may go without a byte from the server.
///
/// The harness sends `: heartbeat` comment lines every 15s precisely so that
/// an idle-but-healthy stream is observable on the wire. Three missed
/// heartbeats therefore means dead or frozen, not quiet, and the stream is
/// reported broken so the caller can reattach at its last offset.
const READ_IDLE_TIMEOUT: Duration = Duration::from_secs(45);

/// How often the stream tells the webview it is still going.
///
/// The other half of cancellation. A dropped channel cannot notify Rust, so
/// the stream sends a small event at this cadence: the send fails when the
/// webview is gone, the request is cancelled, and the bound on an unread
/// stream holding a connection is one interval. Mirrors the harness's own
/// heartbeat cadence, so a quiet stream sees as much traffic as a busy one
/// plus one message.
const CHANNEL_HEARTBEAT: Duration = Duration::from_secs(15);

/// One thing a stream delivers, carrying the offset to resume from.
///
/// The offset rides on the event rather than in an envelope around it: an
/// event type that cannot be constructed without an offset is a delivery
/// that cannot happen without one, which is ADR 0045's "a consumer that
/// cannot say where it stopped cannot resume" expressed as a type instead
/// of a convention.
///
/// The value is where to re-read from, not where the event was stored: it is
/// the last offset the stream reported, so resuming replays this event
/// rather than skipping it. Replay is the safe direction -- the store's
/// reads are by offset and its appends are idempotent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum StreamEvent {
    /// An SSE frame addressed to the consumer, as it arrived.
    Frame {
        offset: String,
        event: Option<String>,
        data: String,
    },
    /// The stream caught up with the run and is now live: what follows is
    /// history being made, not history being replayed.
    ///
    /// Emitted on the transition only. "Still replaying" is the absence of
    /// this plus frames that keep arriving, which a consumer already shows.
    UpToDate { offset: String },
    /// Nothing new, still here. Exists so cancellation has something to
    /// notice, and so a quiet run is distinguishable from a stuck one.
    KeepAlive { offset: String },
    /// The run finished and the stream closed. The only normal end; the
    /// command returns `Ok(())` alongside it.
    Ended { offset: String },
}

/// What the body-reader task reports upward. The terminal states are exactly
/// two: the body ended, or the transport failed. Which of those means
/// "broken" is decided above this type, by the close frame -- not here,
/// where the body is bytes and the protocol is not yet parsed.
enum BodyChunk {
    Bytes(Vec<u8>),
    Ended,
    /// Already redacted: the reader holds the token, the consumer of this
    /// channel does not.
    Failed(String),
}

/// How the consume loop ended. Everything after it is the same cleanup and
/// the same classification, so the loop says what happened and one `match`
/// decides what it means.
enum Outcome {
    /// The harness said the run is over (`closed: true`).
    Closed,
    /// The server finished the body without the close frame that ends a
    /// finished run.
    BodyEnded,
    /// A send into the channel failed: the webview is gone.
    ReaderGone,
    /// The webview cancelled this stream id. Nothing is wrong with the
    /// harness, and there is nobody left to tell.
    Cancelled,
    Broken(String),
}

/// What delivering one frame did.
///
/// `Err` is the stream broken by protocol violation -- a `control` frame
/// that is not the protocol -- and carries the message for `StreamBroken`.
/// A gone reader is `Ok(Delivery::ReaderGone)`: nothing is wrong with the
/// stream, only with its audience.
enum Delivery {
    Continue,
    /// The frame was the close frame; an `Ended` event has been sent.
    Closed,
    ReaderGone,
}

/// Issues one streaming request to a named side system and delivers its
/// events over a channel as they arrive.
///
/// Split from the `#[tauri::command]` wrapper in `lib.rs` for the same
/// reason as `service_fetch`: testability without a Tauri app.
///
/// The `stream_id` is the webview's handle for cancelling this read
/// (`service_stream_cancel`); it must be non-empty, because an unnamed
/// stream is one nobody can ever stop. The registration guards the whole
/// request, so a stream that ends on its own releases its entry whatever
/// the exit.
///
/// The argument count is deliberate: every parameter after the supervisor is
/// one name the webview sends, and the invoke boundary matches those names.
/// A struct would hide the contract, not shrink it.
#[allow(clippy::too_many_arguments)]
pub async fn service_stream(
    supervisor: &HarnessSupervisor,
    registry: &Arc<StreamRegistry>,
    service: ServiceId,
    path: String,
    init: ServiceRequestInit,
    offset: String,
    stream_id: &str,
    channel: Channel<StreamEvent>,
) -> Result<(), ServiceError> {
    if stream_id.is_empty() {
        return Err(ServiceError::InvalidRequest {
            message:
                "the stream id is empty; a stream that cannot be named cannot be cancelled"
                    .to_owned(),
        });
    }
    let (registration, cancel) = registry.register(stream_id);
    let result = match service {
        ServiceId::Harness => {
            let endpoint = supervisor.get_endpoint().ok_or(ServiceError::NotRunning)?;
            harness_stream(
                &endpoint,
                &path,
                init,
                offset,
                channel,
                CHANNEL_HEARTBEAT,
                cancel,
            )
            .await
        }
    };
    drop(registration);
    result
}

/// Waits for the cancellation signal.
///
/// A closed signal source counts as cancelled too: the registry drops a
/// sender when its entry is released or overwritten, and a stream whose
/// registration is gone has no business still reading. Used in both selects
/// -- the connect and the consume loop -- so there is no phase of a stream
/// where cancellation waits on the harness instead of the user.
async fn cancelled(cancel: &mut watch::Receiver<bool>) {
    let _ = cancel.changed().await;
}

/// The one arm, against a resolved endpoint.
///
/// `heartbeat_every` is a parameter rather than the constant so tests can
/// observe cancellation in milliseconds; the command passes
/// [`CHANNEL_HEARTBEAT`]. `cancel` is the registry's half of the same story:
/// the webview's prompt stop, watched in both selects below.
pub(crate) async fn harness_stream(
    endpoint: &HarnessEndpoint,
    path: &str,
    init: ServiceRequestInit,
    offset: String,
    channel: Channel<StreamEvent>,
    heartbeat_every: Duration,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), ServiceError> {
    let url = compose_stream_url(endpoint, path, &offset)?;
    let method = method_from_init(&init)?;

    let client = seam_client()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|error| request_failure(&endpoint.token, error))?;

    let request = apply_init(
        client
            .request(method, url)
            // Asking for what is about to be parsed. Flue's reader does not
            // require it, but a proxy or a future route answering a plain
            // GET here is better refused once, at the door, than parsed as
            // a stream that never frames.
            .header("accept", "text/event-stream"),
        endpoint,
        init,
    )
    .build()
    .map_err(|error| ServiceError::InvalidRequest {
        message: error.to_string(),
    })?;

    let response = tokio::select! {
        result = client.execute(request) => result
            .map_err(|error| request_failure(&endpoint.token, error))?,
        _ = cancelled(&mut cancel) => {
            // The webview stopped caring before the harness answered. There
            // is no reader task yet and nothing to tear down; dropping this
            // future drops the request, which closes the connection.
            log::debug!("service_stream: cancelled while connecting");
            return Ok(());
        }
    };

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(ServiceError::StreamRefused {
            status: status.as_u16(),
            message: redact(&excerpt(&body), &endpoint.token),
        });
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    if !content_type.starts_with("text/event-stream") {
        return Err(ServiceError::StreamRefused {
            status: status.as_u16(),
            message: format!("answered {status} with content-type {content_type}"),
        });
    }

    // The body is read by its own task and reaches the loop below as chunks,
    // because the loop must also watch a heartbeat and an idle deadline.
    // Awaiting `chunk()` directly inside `select!` would rely on its
    // cancellation safety across a drop; a task with a channel does not rely
    // on anything -- aborting the task drops the response, and dropping the
    // response is what cancels the HTTP request.
    let (chunks_tx, mut chunks_rx) = tokio::sync::mpsc::channel::<BodyChunk>(8);
    let reader_token = endpoint.token.clone();
    let reader = tokio::spawn(async move {
        let mut response = response;
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    if chunks_tx
                        .send(BodyChunk::Bytes(chunk.to_vec()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(None) => {
                    // Awaited, not `let _ =`-ed: a send future nobody polls
                    // sends nothing, and the terminal marker is how the
                    // loop above tells an ended body from an aborted task.
                    let _ = chunks_tx.send(BodyChunk::Ended).await;
                    break;
                }
                Err(error) => {
                    let _ = chunks_tx
                        .send(BodyChunk::Failed(redact(&error.to_string(), &reader_token)))
                        .await;
                    break;
                }
            }
        }
    });

    let mut parser = SseParser::new();
    // Seeded with the requested offset: before the first control frame
    // reports better, the honest resume point for anything already delivered
    // is where this stream started reading.
    let mut current_offset = offset;
    let mut up_to_date = false;
    let mut last_byte = tokio::time::Instant::now();
    let mut heartbeat = tokio::time::interval(heartbeat_every);
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    // `interval`'s first tick completes immediately; consuming it here keeps
    // the first keep-alive a full period away, so a stream's opening is
    // narrated by its frames rather than by a keep-alive racing them.
    heartbeat.tick().await;

    let outcome = 'consume: loop {
        tokio::select! {
            chunk = chunks_rx.recv() => {
                let chunk = match chunk {
                    Some(chunk) => chunk,
                    None => break 'consume Outcome::Broken(
                        "the body reader stopped without an end".to_owned(),
                    ),
                };
                match chunk {
                    BodyChunk::Bytes(bytes) => {
                        last_byte = tokio::time::Instant::now();
                        let frames = match parser.push(&bytes) {
                            Ok(frames) => frames,
                            Err(error) => break 'consume Outcome::Broken(format!(
                                "the stream is not valid UTF-8: {error}"
                            )),
                        };
                        for frame in frames {
                            match deliver(frame, &mut current_offset, &mut up_to_date, &channel) {
                                Ok(Delivery::Continue) => {}
                                Ok(Delivery::Closed) => {
                                    break 'consume Outcome::Closed;
                                }
                                Ok(Delivery::ReaderGone) => {
                                    break 'consume Outcome::ReaderGone;
                                }
                                Err(message) => {
                                    break 'consume Outcome::Broken(message);
                                }
                            }
                        }
                    }
                    BodyChunk::Ended => break 'consume Outcome::BodyEnded,
                    BodyChunk::Failed(message) => break 'consume Outcome::Broken(message),
                }
            }
            _ = heartbeat.tick() => {
                if channel
                    .send(StreamEvent::KeepAlive {
                        offset: current_offset.clone(),
                    })
                    .is_err()
                {
                    break 'consume Outcome::ReaderGone;
                }
            }
            _ = cancelled(&mut cancel) => {
                break 'consume Outcome::Cancelled;
            }
            _ = tokio::time::sleep_until(last_byte + READ_IDLE_TIMEOUT) => {
                break 'consume Outcome::Broken(format!(
                    "no bytes for {}s; the harness heartbeats every 15s, so the server is dead or frozen",
                    READ_IDLE_TIMEOUT.as_secs()
                ));
            }
        }
    };

    // Deterministic, and the point of the design: this is where the HTTP
    // request is cancelled, on every exit path, including a stream that
    // simply finished.
    reader.abort();
    let _ = reader.await;

    match outcome {
        Outcome::Closed => Ok(()),
        Outcome::ReaderGone => {
            // Nothing is wrong with the stream; its consumer is gone. There
            // is nobody to tell, so this is a log line, not an error -- and
            // not a silent `Ok(())` either, which would be indistinguishable
            // from a finished run in any future diagnostic that counted them.
            log::debug!("service_stream: the channel stopped accepting; request cancelled");
            Ok(())
        }
        Outcome::Cancelled => {
            // Same audience problem as `ReaderGone` -- the canceller asked
            // for exactly this -- but a different fact worth being able to
            // tell apart in the logs: this session ended its own stream,
            // which is routine (a conversation switch), not a death.
            // Reattaching is the caller's business; the offset it needs was
            // on every event already delivered.
            log::debug!("service_stream: cancelled through its stream id");
            Ok(())
        }
        Outcome::BodyEnded => {
            // The server closed the connection without the close frame that
            // ends a finished run, so this is a break, not an end. Frames
            // that completed before the wire went quiet are real and are
            // delivered first -- with their offsets, so the reattach this
            // error asks for starts from the last one.
            match parser.finish() {
                Ok(frames) => {
                    for frame in frames {
                        match deliver(frame, &mut current_offset, &mut up_to_date, &channel) {
                            Ok(Delivery::Continue) => {}
                            Ok(Delivery::Closed) => return Ok(()),
                            Ok(Delivery::ReaderGone) => return Ok(()),
                            Err(message) => {
                                return Err(ServiceError::StreamBroken { message });
                            }
                        }
                    }
                    Err(ServiceError::StreamBroken {
                        message: "the stream ended without a close frame".to_owned(),
                    })
                }
                Err(error) => Err(ServiceError::StreamBroken {
                    message: format!("the stream is not valid UTF-8: {error}"),
                }),
            }
        }
        Outcome::Broken(message) => Err(ServiceError::StreamBroken { message }),
    }
}

/// Classifies and delivers one parsed frame.
///
/// `control` frames are the harness talking about the stream -- the next
/// offset, whether the reader is live, whether the run is over -- and are
/// consumed here rather than forwarded: their facts reach the webview as the
/// offset on every event and as `UpToDate`/`Ended`. Everything else is the
/// run itself, and goes through untouched.
fn deliver(
    frame: SseFrame,
    current_offset: &mut String,
    up_to_date: &mut bool,
    channel: &Channel<StreamEvent>,
) -> Result<Delivery, String> {
    if frame.event.as_deref() != Some("control") {
        let sent = channel.send(StreamEvent::Frame {
            offset: current_offset.clone(),
            event: frame.event,
            data: frame.data,
        });
        return match sent {
            Ok(()) => Ok(Delivery::Continue),
            Err(_) => Ok(Delivery::ReaderGone),
        };
    }

    let control: serde_json::Value = match serde_json::from_str(&frame.data) {
        Ok(value) => value,
        Err(_) => return Err("a control frame was not valid JSON".to_owned()),
    };
    // The next offset is the one fact a control frame cannot omit: without
    // it, the resume contract this module exists for is already broken, and
    // the honest response is a broken stream rather than a quiet guess.
    let next = match control.get("streamNextOffset").and_then(|value| value.as_str()) {
        Some(next) => next.to_owned(),
        None => return Err("a control frame carried no streamNextOffset".to_owned()),
    };
    *current_offset = next;

    let now_up_to_date = control.get("upToDate").and_then(|value| value.as_bool()) == Some(true);
    if now_up_to_date && !*up_to_date {
        *up_to_date = true;
        if channel
            .send(StreamEvent::UpToDate {
                offset: current_offset.clone(),
            })
            .is_err()
        {
            return Ok(Delivery::ReaderGone);
        }
    } else if !now_up_to_date {
        // Behind the tail again after having been live: new events are being
        // replayed into the stream. No event for this direction -- frames
        // arriving says it -- but the transition must re-arm so a later
        // catch-up is reported again.
        *up_to_date = false;
    }

    if control.get("closed").and_then(|value| value.as_bool()) == Some(true) {
        if channel
            .send(StreamEvent::Ended {
                offset: current_offset.clone(),
            })
            .is_err()
        {
            return Ok(Delivery::ReaderGone);
        }
        return Ok(Delivery::Closed);
    }
    Ok(Delivery::Continue)
}

/// Builds the full stream URL: the endpoint, the caller's path, the offset,
/// and `live=sse` unless the caller chose a live mode themselves.
///
/// The offset is this command's to add, so a path that already carries one
/// is refused rather than sent -- the reader would reject two, and the error
/// would name the wrong layer. A fragment is refused for the same reason:
/// anything appended after `#` is not query, and the offset would silently
/// join the fragment instead of the request.
fn compose_stream_url(
    endpoint: &HarnessEndpoint,
    path: &str,
    offset: &str,
) -> Result<String, ServiceError> {
    validate_path(path)?;
    if path.contains('#') {
        return Err(ServiceError::InvalidPath {
            message: "a stream path cannot carry a fragment: the offset would join it, not the query".to_owned(),
        });
    }
    if offset.is_empty() {
        return Err(ServiceError::InvalidRequest {
            message: "the offset is empty; a stream must say where to resume from (-1 for the beginning)".to_owned(),
        });
    }
    let query = path.split_once('?').map(|(_, query)| query);
    let has_live = query.is_some_and(|q| {
        q.split('&')
            .any(|parameter| parameter.split('=').next() == Some("live"))
    });
    let carries_offset = query.is_some_and(|q| {
        q.split('&')
            .any(|parameter| parameter.split('=').next() == Some("offset"))
    });
    if carries_offset {
        return Err(ServiceError::InvalidRequest {
            message: "the path already carries an offset; service_stream adds its own, and two are not a request the reader accepts".to_owned(),
        });
    }

    let mut url = format!("{}{}", endpoint.url, path);
    url.push(if url.contains('?') { '&' } else { '?' });
    url.push_str("offset=");
    url.push_str(&encode_query_component(offset));
    if !has_live {
        url.push_str("&live=sse");
    }
    Ok(url)
}

/// Percent-encodes one query component.
///
/// A valid offset (`-1`, or digits and underscores) encodes as itself, since
/// every character in it is unreserved. Anything else a caller passes is
/// still contained within the one parameter rather than becoming query
/// structure the server would read.
fn encode_query_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push('%');
                encoded.push_str(&format!("{byte:02X}"));
            }
        }
    }
    encoded
}

/// Keeps the front of a refusal body, on a character boundary.
///
/// Refusal bodies here are JSON errors, small; this is a bound, not a
/// truncate that ever expects to run. Slicing by byte panics mid-codepoint,
/// and the text is whatever the server wrote.
fn excerpt(text: &str) -> String {
    const EXCERPT_BYTES: usize = 200;
    if text.len() <= EXCERPT_BYTES {
        return text.to_owned();
    }
    let mut end = EXCERPT_BYTES;
    while end < text.len() && !text.is_char_boundary(end) {
        end += 1;
    }
    text[..end].to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read as _, Write as _};
    use std::net::{Shutdown, TcpListener, TcpStream};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    /// Heartbeat long enough that no sequence test ever sees a keep-alive;
    /// the tests that want one pass their own interval.
    const NO_HEARTBEAT: Duration = Duration::from_secs(600);

    /// A cancellation receiver nobody will ever fire, for the tests that are
    /// about some other outcome. The sender comes back too so the scope --
    /// not the registry -- decides how long the stream can be cancelled.
    fn uncancelled() -> (watch::Sender<bool>, watch::Receiver<bool>) {
        watch::channel(false)
    }

    const SSE_HEAD: &str =
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-cache\r\n\r\n";

    /// What a recording channel hands back: every event, with the instant it
    /// was delivered.
    type Recording = Arc<Mutex<Vec<(Instant, StreamEvent)>>>;

    /// What the stub learned about the one request it served.
    #[derive(Default, Clone)]
    struct Captured {
        request_line: String,
        authorization: Option<String>,
    }

    /// Serves exactly one connection on a random loopback port.
    ///
    /// std rather than a test-server crate: the responses these tests need
    /// are a head, some frames, a pause and a close, and owning the socket
    /// is what makes "the server observed the disconnect" assertable at
    /// all -- a real HTTP framework would have to be asked for that.
    ///
    /// After `script` returns, the stub keeps writing SSE comment lines
    /// until the client goes away, and records that it noticed. Comments
    /// are the probe: they are bytes a client must ignore, and a failing
    /// write is the one cross-platform observation of the other end having
    /// closed.
    fn spawn_stub<F>(
        script: F,
    ) -> (std::net::SocketAddr, Arc<Mutex<Option<Captured>>>, Arc<AtomicBool>)
    where
        F: FnOnce(Captured, &mut TcpStream) + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback listener");
        let addr = listener.local_addr().expect("a local address");
        let captured = Arc::new(Mutex::new(None));
        let disconnected = Arc::new(AtomicBool::new(false));

        let captured_here = captured.clone();
        let disconnected_here = disconnected.clone();
        std::thread::spawn(move || {
            let (mut stream, _) = match listener.accept() {
                Ok(pair) => pair,
                Err(_) => return,
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("a read timeout");

            // The request head. Every request the seam issues is bodyless.
            let mut head = Vec::new();
            let mut chunk = [0u8; 512];
            while !head.ends_with(b"\r\n\r\n") {
                let read = stream.read(&mut chunk).unwrap_or(0);
                if read == 0 {
                    return;
                }
                head.extend_from_slice(&chunk[..read]);
            }
            let text = String::from_utf8_lossy(&head).into_owned();
            let mut lines = text.split("\r\n");
            let request_line = lines.next().unwrap_or_default().to_owned();
            let authorization = lines.find_map(|line| {
                let (name, value) = line.split_once(':')?;
                if name.trim().eq_ignore_ascii_case("authorization") {
                    Some(value.trim().to_owned())
                } else {
                    None
                }
            });
            let captured = Captured {
                request_line,
                authorization,
            };
            *captured_here.lock().expect("captured") = Some(captured.clone());

            script(captured, &mut stream);

            let probe_started = Instant::now();
            while !disconnected_here.load(Ordering::SeqCst)
                && probe_started.elapsed() < Duration::from_secs(30)
            {
                if stream.write_all(b": probe\n\n").is_err() {
                    disconnected_here.store(true, Ordering::SeqCst);
                    return;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        });

        (addr, captured, disconnected)
    }

    /// An endpoint aimed at the stub, with a token the tests can look for.
    fn endpoint_for(addr: std::net::SocketAddr) -> HarnessEndpoint {
        HarnessEndpoint {
            host: "127.0.0.1".to_owned(),
            port: addr.port(),
            pid: std::process::id(),
            url: format!("http://{addr}"),
            client_id: "test".to_owned(),
            session_id: "test".to_owned(),
            token: "stub-bearer-value".to_owned(),
        }
    }

    /// A channel that records what it is handed, and when.
    fn recording_channel() -> (Channel<StreamEvent>, Recording) {
        let events: Recording = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let channel = Channel::new(move |body| {
            let tauri::ipc::InvokeResponseBody::Json(json) = body else {
                return Err(tauri::Error::Io(std::io::Error::other(
                    "the seam delivered a non-JSON body",
                )));
            };
            let event: StreamEvent = serde_json::from_str(&json)?;
            sink.lock().expect("events").push((Instant::now(), event));
            Ok(())
        });
        (channel, events)
    }

    /// A channel whose sends always fail: the webview is gone.
    fn failing_channel() -> Channel<StreamEvent> {
        Channel::new(|_| {
            Err(tauri::Error::Io(std::io::Error::other(
                "the webview is gone",
            )))
        })
    }

    /// One frame, shaped the way the harness writes them: the event name
    /// with a space, the data without one.
    fn frame(event: &str, data: &str) -> String {
        format!("event: {event}\ndata:{data}\n\n")
    }

    /// The offset every variant of [`StreamEvent`] carries. Existing as one
    /// function is itself the assertion that none of them can avoid it.
    fn offset_of(event: &StreamEvent) -> &str {
        match event {
            StreamEvent::Frame { offset, .. }
            | StreamEvent::UpToDate { offset }
            | StreamEvent::KeepAlive { offset }
            | StreamEvent::Ended { offset } => offset,
        }
    }

    /// Polls until true or the deadline: disconnects are observed by a
    /// failing write, which happens some time after the close, not at it.
    fn eventually(flag: &AtomicBool, within: Duration) -> bool {
        let started = Instant::now();
        while started.elapsed() < within {
            if flag.load(Ordering::SeqCst) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        flag.load(Ordering::SeqCst)
    }

    #[tokio::test]
    async fn the_credential_is_attached_to_a_streaming_request() {
        let (addr, captured, _disconnected) = spawn_stub(|_request, stream| {
            stream.write_all(SSE_HEAD.as_bytes()).expect("head");
            stream
                .write_all(frame("control", r#"{"streamNextOffset":"1_0","closed":true}"#).as_bytes())
                .expect("close frame");
        });

        let (channel, events) = recording_channel();
        let (_never, cancel) = uncancelled();
        let result = harness_stream(

            &endpoint_for(addr),
            "/agents/claude/42",
            ServiceRequestInit::default(),
            "4_0".to_owned(),
            channel,
            NO_HEARTBEAT,
            cancel,
        )
        .await;

        assert!(
            result.is_ok(),
            "a closed stream is a normal end: {result:?}"
        );
        let captured = captured.lock().expect("captured");
        let captured = captured.as_ref().expect("a request was served");
        assert_eq!(
            captured.request_line,
            "GET /agents/claude/42?offset=4_0&live=sse HTTP/1.1",
            "the request the seam actually issued"
        );
        assert_eq!(
            captured.authorization.as_deref(),
            Some("Bearer stub-bearer-value"),
            "the credential Rust holds is the one the stream carried"
        );
        let events = events.lock().expect("events");
        assert!(
            events
                .last()
                .is_some_and(|(_, event)| matches!(event, StreamEvent::Ended { .. })),
            "the close frame is a delivered end: {:?}",
            *events
        );
    }

    #[tokio::test]
    async fn an_absolute_url_in_path_is_refused_before_any_request_is_made() {
        let (addr, captured, _disconnected) = spawn_stub(|_request, _stream| {});

        let (_never, cancel) = uncancelled();
        let error = harness_stream(

            &endpoint_for(addr),
            "http://127.0.0.1:9/x",
            ServiceRequestInit::default(),
            "4_0".to_owned(),
            recording_channel().0,
            NO_HEARTBEAT,
            cancel,
        )
        .await
        .expect_err("an absolute URL is not a path");

        assert!(
            matches!(error, ServiceError::InvalidPath { .. }),
            "{error:?}"
        );
        std::thread::sleep(Duration::from_millis(200));
        assert!(
            captured.lock().expect("captured").is_none(),
            "the refusal must happen before any connection exists"
        );
    }

    #[tokio::test]
    async fn events_arrive_incrementally_not_in_one_batch_at_the_end() {
        // The server records when it wrote the second frame; the client
        // records when each event was delivered. Delivering the first before
        // the second was even written is the thing being asserted -- a
        // buffered implementation cannot pass it.
        let second_write = Arc::new(Mutex::new(None::<Instant>));
        let second_write_here = second_write.clone();
        let (addr, _captured, _disconnected) = spawn_stub(move |_request, stream| {
            stream.write_all(SSE_HEAD.as_bytes()).expect("head");
            stream
                .write_all(frame("data", r#"{"text":"first"}"#).as_bytes())
                .expect("first frame");
            std::thread::sleep(Duration::from_millis(400));
            *second_write_here.lock().expect("second write") = Some(Instant::now());
            stream
                .write_all(frame("control", r#"{"streamNextOffset":"1_0","closed":true}"#).as_bytes())
                .expect("close frame");
        });

        let (channel, events) = recording_channel();
        let (_never, cancel) = uncancelled();
        let result = harness_stream(

            &endpoint_for(addr),
            "/agents/claude/42",
            ServiceRequestInit::default(),
            "0_0".to_owned(),
            channel,
            NO_HEARTBEAT,
            cancel,
        )
        .await;
        assert!(result.is_ok(), "{result:?}");

        let events = events.lock().expect("events");
        let first_delivery = events
            .iter()
            .find(|(_, event)| matches!(event, StreamEvent::Frame { .. }))
            .map(|(at, _)| *at)
            .expect("a frame event was delivered");
        let second_write = second_write
            .lock()
            .expect("second write")
            .expect("two writes happened");
        assert!(
            first_delivery < second_write,
            "the first frame was delivered only after the stream had ended"
        );
    }

    #[tokio::test]
    async fn the_offset_accompanies_every_delivered_event() {
        let (addr, _captured, _disconnected) = spawn_stub(|_request, stream| {
            stream.write_all(SSE_HEAD.as_bytes()).expect("head");
            stream
                .write_all(frame("data", r#"{"a":1}"#).as_bytes())
                .expect("frame");
            stream
                .write_all(frame("control", r#"{"streamNextOffset":"5_1"}"#).as_bytes())
                .expect("control");
            stream
                .write_all(frame("data", r#"{"b":2}"#).as_bytes())
                .expect("frame");
            stream
                .write_all(frame("control", r#"{"streamNextOffset":"6_1","upToDate":true}"#).as_bytes())
                .expect("control");
            stream
                .write_all(frame("control", r#"{"streamNextOffset":"6_2","closed":true}"#).as_bytes())
                .expect("close frame");
        });

        let (channel, events) = recording_channel();
        let (_never, cancel) = uncancelled();
        let result = harness_stream(

            &endpoint_for(addr),
            "/agents/claude/42",
            ServiceRequestInit::default(),
            "4_0".to_owned(),
            channel,
            NO_HEARTBEAT,
            cancel,
        )
        .await;
        assert!(result.is_ok(), "{result:?}");

        let delivered: Vec<StreamEvent> = events
            .lock()
            .expect("events")
            .iter()
            .map(|(_, event)| event.clone())
            .collect();
        assert!(
            delivered.iter().all(|event| !offset_of(event).is_empty()),
            "every delivered event carries an offset: {delivered:?}"
        );
        // Before the first control frame reports better, the honest resume
        // point is where reading started; after it, the reported next
        // offset. A resume from the carried offset replays the event it
        // rides on; it never skips one.
        assert_eq!(
            delivered,
            vec![
                StreamEvent::Frame {
                    offset: "4_0".to_owned(),
                    event: Some("data".to_owned()),
                    data: r#"{"a":1}"#.to_owned(),
                },
                StreamEvent::Frame {
                    offset: "5_1".to_owned(),
                    event: Some("data".to_owned()),
                    data: r#"{"b":2}"#.to_owned(),
                },
                StreamEvent::UpToDate {
                    offset: "6_1".to_owned(),
                },
                StreamEvent::Ended {
                    offset: "6_2".to_owned(),
                },
            ]
        );
    }

    #[tokio::test]
    async fn a_dropped_channel_cancels_the_request() {
        let (addr, _captured, disconnected) = spawn_stub(|_request, stream| {
            stream.write_all(SSE_HEAD.as_bytes()).expect("head");
            stream
                .write_all(frame("data", r#"{"a":1}"#).as_bytes())
                .expect("frame");
            // Long enough for the client to have tried, and failed, to
            // deliver the frame to a webview that is gone.
            std::thread::sleep(Duration::from_millis(300));
        });

        let (_never, cancel) = uncancelled();
        let result = harness_stream(

            &endpoint_for(addr),
            "/agents/claude/42",
            ServiceRequestInit::default(),
            "0_0".to_owned(),
            failing_channel(),
            NO_HEARTBEAT,
            cancel,
        )
        .await;

        assert!(
            result.is_ok(),
            "a gone reader is not a broken stream: {result:?}"
        );
        assert!(
            eventually(&disconnected, Duration::from_secs(5)),
            "the server never observed the cancellation"
        );
    }

    #[tokio::test]
    async fn an_idle_stream_with_a_dead_reader_is_cancelled_by_the_heartbeat() {
        // The server says nothing at all: no frames to deliver, so only the
        // heartbeat's failing send can notice the reader is gone. This is
        // the bound on an unread stream holding a connection open.
        let (addr, _captured, disconnected) = spawn_stub(|_request, stream| {
            stream.write_all(SSE_HEAD.as_bytes()).expect("head");
        });

        let (_never, cancel) = uncancelled();
        let result = harness_stream(
            &endpoint_for(addr),
            "/agents/claude/42",
            ServiceRequestInit::default(),
            "0_0".to_owned(),
            failing_channel(),
            Duration::from_millis(100),
            cancel,
        )
        .await;

        assert!(result.is_ok(), "{result:?}");
        assert!(
            eventually(&disconnected, Duration::from_secs(5)),
            "the server never observed the cancellation"
        );
    }

    #[tokio::test]
    async fn a_mid_stream_break_reports_as_broken_after_start_not_never_started() {
        // A complete frame, then half of another, then the connection goes.
        // The half-frame is discarded with the break; the whole one was
        // real, delivered with its offset; and the end is a broken stream,
        // because the close frame that ends a finished run never came.
        let (addr, _captured, _disconnected) = spawn_stub(|_request, stream| {
            stream.write_all(SSE_HEAD.as_bytes()).expect("head");
            stream
                .write_all(frame("data", r#"{"a":1}"#).as_bytes())
                .expect("frame");
            stream
                .write_all(b"event: data\ndata:{\"trun")
                .expect("half of a frame");
            let _ = stream.shutdown(Shutdown::Both);
        });

        let (channel, events) = recording_channel();
        let (_never, cancel) = uncancelled();
        let error = harness_stream(
            &endpoint_for(addr),
            "/agents/claude/42",
            ServiceRequestInit::default(),
            "0_0".to_owned(),
            channel,
            NO_HEARTBEAT,
            cancel,
        )
        .await
        .expect_err("a stream that ends without a close frame is broken");

        let ServiceError::StreamBroken { message } = error else {
            panic!("expected StreamBroken, got {error:?}");
        };
        assert!(message.contains("close frame"), "{message}");
        let events = events.lock().expect("events");
        assert!(
            events.iter().any(|(_, event)| matches!(
                event,
                StreamEvent::Frame { data, .. } if data == r#"{"a":1}"#
            )),
            "the frame that completed before the break was delivered: {:?}",
            *events
        );
        assert!(
            !events
                .iter()
                .any(|(_, event)| matches!(event, StreamEvent::Ended { .. })),
            "a break is not an end"
        );
    }

    #[tokio::test]
    async fn a_refusal_surfaces_status_and_body_and_never_started() {
        let (addr, _captured, _disconnected) = spawn_stub(|_request, stream| {
            stream
                .write_all(b"HTTP/1.1 401 Unauthorized\r\ncontent-type: text/plain\r\ncontent-length: 6\r\n\r\ndenied")
                .expect("refusal");
        });

        let (_never, cancel) = uncancelled();
        let error = harness_stream(

            &endpoint_for(addr),
            "/agents/claude/42",
            ServiceRequestInit::default(),
            "0_0".to_owned(),
            recording_channel().0,
            NO_HEARTBEAT,
            cancel,
        )
        .await
        .expect_err("a refusal is not a stream");

        let ServiceError::StreamRefused { status, message } = error else {
            panic!("expected StreamRefused, got {error:?}");
        };
        assert_eq!(status, 401);
        assert!(message.contains("denied"), "{message}");
    }

    #[tokio::test]
    async fn a_control_frame_without_an_offset_breaks_the_stream() {
        // The next offset is the resume contract; a control frame without
        // one is the protocol already broken, and a quiet guess would lose
        // events at the next reattach.
        let (addr, _captured, _disconnected) = spawn_stub(|_request, stream| {
            stream.write_all(SSE_HEAD.as_bytes()).expect("head");
            stream
                .write_all(frame("control", r#"{"upToDate":true}"#).as_bytes())
                .expect("control");
            let _ = stream.shutdown(Shutdown::Both);
        });

        let (_never, cancel) = uncancelled();
        let error = harness_stream(

            &endpoint_for(addr),
            "/agents/claude/42",
            ServiceRequestInit::default(),
            "0_0".to_owned(),
            recording_channel().0,
            NO_HEARTBEAT,
            cancel,
        )
        .await
        .expect_err("a control frame must carry the next offset");

        assert!(
            matches!(error, ServiceError::StreamBroken { .. }),
            "{error:?}"
        );
    }

    #[tokio::test]
    async fn up_to_date_is_reported_again_after_falling_behind() {
        let (addr, _captured, _disconnected) = spawn_stub(|_request, stream| {
            stream.write_all(SSE_HEAD.as_bytes()).expect("head");
            for data in [
                r#"{"streamNextOffset":"1_0","upToDate":true}"#,
                r#"{"streamNextOffset":"2_0"}"#,
                r#"{"streamNextOffset":"3_0","upToDate":true}"#,
                r#"{"streamNextOffset":"3_1","closed":true}"#,
            ] {
                stream
                    .write_all(frame("control", data).as_bytes())
                    .expect("control");
            }
        });

        let (channel, events) = recording_channel();
        let (_never, cancel) = uncancelled();
        let result = harness_stream(

            &endpoint_for(addr),
            "/agents/claude/42",
            ServiceRequestInit::default(),
            "0_0".to_owned(),
            channel,
            NO_HEARTBEAT,
            cancel,
        )
        .await;
        assert!(result.is_ok(), "{result:?}");

        let up_to_dates: Vec<String> = events
            .lock()
            .expect("events")
            .iter()
            .filter_map(|(_, event)| match event {
                StreamEvent::UpToDate { offset } => Some(offset.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(
            up_to_dates,
            vec!["1_0".to_owned(), "3_0".to_owned()],
            "catching up twice must be reported twice"
        );
    }

    #[tokio::test]
    async fn a_live_mode_the_caller_chose_is_not_duplicated() {
        let (addr, captured, _disconnected) = spawn_stub(|_request, stream| {
            stream.write_all(SSE_HEAD.as_bytes()).expect("head");
            stream
                .write_all(frame("control", r#"{"streamNextOffset":"1_0","closed":true}"#).as_bytes())
                .expect("close frame");
        });

        let (_never, cancel) = uncancelled();
        let result = harness_stream(

            &endpoint_for(addr),
            "/agents/claude/42?live=long-poll",
            ServiceRequestInit::default(),
            "0_0".to_owned(),
            recording_channel().0,
            NO_HEARTBEAT,
            cancel,
        )
        .await;
        assert!(result.is_ok(), "{result:?}");

        let captured = captured.lock().expect("captured");
        let captured = captured.as_ref().expect("a request was served");
        assert_eq!(
            captured.request_line,
            "GET /agents/claude/42?live=long-poll&offset=0_0 HTTP/1.1",
            "the caller's live mode stands, and exactly one is sent"
        );
    }

    #[tokio::test]
    async fn no_error_a_stream_produces_contains_the_credential() {
        let (addr, _captured, _disconnected) = spawn_stub(|_request, stream| {
            stream
                .write_all(b"HTTP/1.1 500 Internal Server Error\r\ncontent-length: 0\r\n\r\n")
                .expect("refusal");
        });

        let (_never, cancel) = uncancelled();
        let refused = harness_stream(
            &endpoint_for(addr),
            "/agents/claude/42",
            ServiceRequestInit::default(),
            "0_0".to_owned(),
            recording_channel().0,
            NO_HEARTBEAT,
            cancel,
        )
        .await
        .expect_err("the stub refuses everything");

        let (_never_either, cancel) = uncancelled();
        let absolute = harness_stream(
            &endpoint_for(addr),
            "http://127.0.0.1:9/x",
            ServiceRequestInit::default(),
            "0_0".to_owned(),
            recording_channel().0,
            NO_HEARTBEAT,
            cancel,
        )
        .await
        .expect_err("an absolute URL is not a path");

        let never_started = service_stream(
            &HarnessSupervisor::new(),
            &Arc::new(StreamRegistry::default()),
            ServiceId::Harness,
            "/agents/claude/42".to_owned(),
            ServiceRequestInit::default(),
            "0_0".to_owned(),
            "test-stream",
            recording_channel().0,
        )
        .await
        .expect_err("a supervisor that never started is not running");

        for error in [refused, absolute, never_started] {
            let text = serde_json::to_string(&error).expect("errors serialize");
            assert!(
                !text.contains("stub-bearer-value"),
                "the bearer appeared in an error: {text}"
            );
        }
    }

    #[test]
    fn the_offset_is_added_once_and_cannot_be_smuggled_or_fragmented() {
        let endpoint = HarnessEndpoint {
            host: "127.0.0.1".to_owned(),
            port: 1,
            pid: 1,
            url: "http://127.0.0.1:1".to_owned(),
            client_id: "test".to_owned(),
            session_id: "test".to_owned(),
            token: String::new(),
        };

        assert_eq!(
            compose_stream_url(&endpoint, "/agents/claude/42", "-1").expect("composed"),
            "http://127.0.0.1:1/agents/claude/42?offset=-1&live=sse"
        );
        assert!(matches!(
            compose_stream_url(&endpoint, "/agents/claude/42?offset=9_9", "0_0"),
            Err(ServiceError::InvalidRequest { .. })
        ));
        assert!(matches!(
            compose_stream_url(&endpoint, "/agents/claude/42#fragment", "0_0"),
            Err(ServiceError::InvalidPath { .. })
        ));
        assert!(matches!(
            compose_stream_url(&endpoint, "/agents/claude/42", ""),
            Err(ServiceError::InvalidRequest { .. })
        ));
        // Anything that is not an unreserved character stays inside the one
        // parameter rather than becoming query structure.
        assert_eq!(encode_query_component("a b&c=d"), "a%20b%26c%3Dd");
    }

    /// How long a cancel gets to stop a live read before the test calls it
    /// unprompt. The whole point of the registry is that this is comfortably
    /// below any heartbeat or idle deadline.
    const CANCEL_BUDGET: Duration = Duration::from_secs(2);

    #[tokio::test]
    async fn a_named_stream_can_be_cancelled_promptly_mid_read() {
        // Head and one frame, then nothing but the stub's comment probes. The
        // old backstop would have kept this connection until a heartbeat's
        // failing send noticed the reader was gone; the registry must end it
        // when the webview says so.
        let (addr, _captured, disconnected) = spawn_stub(|_request, stream| {
            stream.write_all(SSE_HEAD.as_bytes()).expect("head");
            stream
                .write_all(frame("data", r#"{"a":1}"#).as_bytes())
                .expect("frame");
            std::thread::sleep(Duration::from_millis(1_500));
        });

        let registry = Arc::new(StreamRegistry::default());
        let (_registration, cancel) = registry.register("pane-1");
        let (channel, events) = recording_channel();
        let endpoint = endpoint_for(addr);
        let task = tokio::spawn(async move {
            harness_stream(
                &endpoint,
                "/agents/claude/42",
                ServiceRequestInit::default(),
                "0_0".to_owned(),
                channel,
                NO_HEARTBEAT,
                cancel,
            )
            .await
        });

        // Wait for proof the read is live before cancelling: one delivered
        // frame means the request reached the harness and came back.
        let started = Instant::now();
        loop {
            let delivered = events.lock().expect("events").iter().any(|(_, event)| {
                matches!(event, StreamEvent::Frame { .. })
            });
            if delivered || started.elapsed() > CANCEL_BUDGET {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }

        assert!(registry.cancel("pane-1"), "the registration was live");
        let result = tokio::time::timeout(CANCEL_BUDGET, task)
            .await
            .expect("cancellation is prompt; it does not wait for a heartbeat")
            .expect("the read task did not panic");
        assert!(result.is_ok(), "a cancelled stream is not an error: {result:?}");
        assert!(
            eventually(&disconnected, Duration::from_secs(5)),
            "the server never observed the cancelled connection"
        );
        // And the entry went with it: cancelling again finds nothing.
        assert!(!registry.cancel("pane-1"));
    }

    #[tokio::test]
    async fn a_cancel_that_arrives_while_connecting_does_not_wait_for_the_harness() {
        // Accepts and then says nothing -- no response head at all -- so the
        // connect phase itself hangs until the cancel lands. A stub framework
        // is not used here because the probe comments it writes before any
        // head would themselves be a malformed HTTP answer.
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback listener");
        let addr = listener.local_addr().expect("a local address");
        std::thread::spawn(move || {
            let (_held, _) = listener.accept().expect("one connection");
            std::thread::sleep(Duration::from_secs(5));
        });

        let registry = Arc::new(StreamRegistry::default());
        let (_registration, cancel) = registry.register("pane-2");
        let endpoint = endpoint_for(addr);
        let task = tokio::spawn(async move {
            harness_stream(
                &endpoint,
                "/agents/claude/42",
                ServiceRequestInit::default(),
                "0_0".to_owned(),
                recording_channel().0,
                NO_HEARTBEAT,
                cancel,
            )
            .await
        });

        tokio::time::sleep(Duration::from_millis(200)).await;
        let started = Instant::now();
        assert!(registry.cancel("pane-2"));
        let result = tokio::time::timeout(CANCEL_BUDGET, task)
            .await
            .expect("cancellation during connect is prompt")
            .expect("the connecting task did not panic");
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "the cancel waited {:?} for a harness that never answered",
            started.elapsed()
        );
        assert!(result.is_ok(), "{result:?}");
    }

    #[tokio::test]
    async fn an_unnamed_stream_is_refused_before_anything_starts() {
        // An id the webview cannot later cancel is a stream nobody can ever
        // prompt-stop; the empty name is refused rather than registered under
        // some invented key.
        let error = service_stream(
            &HarnessSupervisor::new(),
            &Arc::new(StreamRegistry::default()),
            ServiceId::Harness,
            "/agents/claude/42".to_owned(),
            ServiceRequestInit::default(),
            "0_0".to_owned(),
            "",
            recording_channel().0,
        )
        .await
        .expect_err("an unnamed stream cannot be cancelled");

        assert!(matches!(error, ServiceError::InvalidRequest { .. }), "{error:?}");
    }
}
