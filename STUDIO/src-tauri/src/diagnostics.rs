use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use crate::identity::{is_uuid, new_uuid};

const MAX_EVENTS: usize = 2_000;
static ENABLED: AtomicBool = AtomicBool::new(false);
static DROPPED: AtomicU64 = AtomicU64::new(0);
static RECORDER: OnceLock<Mutex<Recorder>> = OnceLock::new();
static POLICY_SYNC: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CLEAR_REVISION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeObservation {
    v: u8,
    event_id: String,
    boot_id: String,
    sequence: u64,
    unix_ms: u64,
    monotonic_ms: u64,
    name: &'static str,
    phase: &'static str,
    outcome: Option<&'static str>,
    operation_id: String,
    request_id: Option<String>,
    stream_id: Option<String>,
    stage: &'static str,
    status: Option<u16>,
    duration_ms: Option<u64>,
    error_code: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeSnapshot {
    #[serde(flatten)]
    health: NativeHealth,
    events: Vec<NativeObservation>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeHealth {
    boot_id: String,
    capture_id: Option<String>,
    enabled: bool,
    dropped: u64,
    evicted: u64,
    retained_events: usize,
    undelivered_events: usize,
}

struct Recorder {
    boot_id: String,
    capture_id: Option<String>,
    started: Instant,
    sequence: u64,
    evicted: u64,
    events: VecDeque<NativeObservation>,
    delivered_through: u64,
}
impl Recorder {
    fn new() -> Self {
        Self { boot_id: new_uuid(), capture_id: None, started: Instant::now(), sequence: 0, evicted: 0, events: VecDeque::new(), delivered_through: 0 }
    }

    fn push(&mut self, mut event: NativeObservation) {
        self.sequence += 1;
        event.sequence = self.sequence;
        event.boot_id.clone_from(&self.boot_id);
        event.monotonic_ms = self.started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        self.events.push_back(event);
        if self.events.len() > MAX_EVENTS { self.events.pop_front(); self.evicted += 1; }
    }

    fn health(&self) -> NativeHealth {
        NativeHealth { boot_id: self.boot_id.clone(), capture_id: self.capture_id.clone(),
            enabled: ENABLED.load(Ordering::Relaxed), dropped: DROPPED.load(Ordering::Relaxed),
            evicted: self.evicted, retained_events: self.events.len(),
            undelivered_events: self.events.iter().filter(|event| event.sequence > self.delivered_through).count() }
    }

    fn snapshot(&self) -> NativeSnapshot {
        NativeSnapshot { health: self.health(), events: self.events.iter().cloned().collect() }
    }
}

fn recorder() -> &'static Mutex<Recorder> { RECORDER.get_or_init(|| Mutex::new(Recorder::new())) }

fn record(span: &NativeSpan, phase: &'static str, outcome: Option<&'static str>, stage: &'static str, status: Option<u16>, error_code: Option<&'static str>) {
    if !ENABLED.load(Ordering::Relaxed) { return; }
    let Ok(mut capture) = recorder().try_lock() else { DROPPED.fetch_add(1, Ordering::Relaxed); return; };
    if !ENABLED.load(Ordering::Relaxed) { return; }
    if capture.capture_id.as_deref() != Some(span.capture_id.as_str()) { return; }
    // Every field is fixed or size-limited. Bodies, paths, headers and error prose
    // never enter this process recorder, including on a harness crash.
    capture.push(NativeObservation {
        v: 1, event_id: new_uuid(), boot_id: String::new(), sequence: 0,
        unix_ms: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().min(u64::MAX as u128) as u64,
        monotonic_ms: 0, name: span.name, phase, outcome, operation_id: span.id.clone(),
        request_id: span.request_id.as_deref().filter(|id| is_uuid(id)).map(str::to_owned),
        stream_id: span.stream_id.as_deref().filter(|id| id.len() <= 128 && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')).map(str::to_owned),
        stage, status, error_code, duration_ms: (phase == "end").then(|| span.started.elapsed().as_millis().min(u64::MAX as u128) as u64),
    });
}

pub(crate) fn lifecycle(stage: &'static str) {
    if let Some(mut span) = NativeSpan::new("native.harness", None, None) {
        record(&span, "progress", None, stage, None, None);
        span.finished = true;
    }
}

/// IPC arrival is evidence of a command being received, not of its completion.
pub(crate) fn command_received(command: &str) {
    let stage = match command {
        "diagnostic_capture_sync" | "diagnostic_capture_snapshot" | "diagnostic_capture_clear" => return,
        "app_ready" => "app_ready",
        "open_conversation_window" => "open_conversation_window",
        "open_diagnostic_window" => "open_diagnostic_window",
        "computer_indicator_show" => "computer_indicator_show",
        "computer_indicator_hide" => "computer_indicator_hide",
        "computer_indicator_stop" => "computer_indicator_stop",
        "quit_app" => "quit_app",
        "read_clipboard_text" => "read_clipboard_text",
        // Diagnostic polling resolves the owner through these read-only probes.
        "get_harness_endpoint" | "get_harness_status" => return,
        "restart_harness" => "restart_harness",
        // Service boundaries observe these after excluding diagnostic routes.
        "service_fetch" | "service_fetch_bytes" | "service_stream" => return,
        "service_stream_cancel" => "service_stream_cancel",
        "remote_access_start" => "remote_access_start",
        "remote_access_stop" => "remote_access_stop",
        "remote_access_status" => "remote_access_status",
        "remote_pairing_code" => "remote_pairing_code",
        "remote_devices" => "remote_devices",
        "remote_device_rename" => "remote_device_rename",
        "remote_device_revoke" => "remote_device_revoke",
        "remote_device_revoke_all" => "remote_device_revoke_all",
        "remote_addresses" => "remote_addresses",
        "open_external_url" => "open_external_url",
        _ => "unrecognized",
    };
    if let Some(mut span) = NativeSpan::new("native.command", None, None) {
        record(&span, "progress", None, stage, None, None);
        span.finished = true;
    }
}

/// Dropped futures remain unknown; completing a reader never means its run ended.
pub(crate) struct NativeSpan {
    name: &'static str,
    id: String,
    request_id: Option<String>,
    stream_id: Option<String>,
    started: Instant,
    finished: bool,
    capture_id: String,
}
impl NativeSpan {
    fn new(name: &'static str, request_id: Option<String>, stream_id: Option<String>) -> Option<Self> {
        if !ENABLED.load(Ordering::Relaxed) { return None; }
        let capture_id = match recorder().try_lock() {
            Ok(capture) => capture.capture_id.clone()?,
            Err(_) => { DROPPED.fetch_add(1, Ordering::Relaxed); return None; }
        };
        Some(Self { name, id: new_uuid(), request_id, stream_id, started: Instant::now(), finished: false, capture_id })
    }
    pub(crate) fn start(name: &'static str, request_id: Option<String>, stream_id: Option<String>) -> Option<Self> {
        let span = Self::new(name, request_id, stream_id)?;
        record(&span, "start", None, "started", None, None);
        Some(span)
    }
    pub(crate) fn finish(mut self, outcome: &'static str, status: Option<u16>, error_code: Option<&'static str>) {
        self.finished = true;
        record(&self, "end", Some(outcome), "settled", status, error_code);
    }
}
impl Drop for NativeSpan {
    fn drop(&mut self) {
        if !self.finished {
            record(self, "end", Some("unknown"), "abandoned", None, None);
        }
    }
}

fn configure(capture_id: Option<String>, expected_revision: Option<u64>) -> Result<NativeHealth, String> {
    if capture_id.as_deref().is_some_and(|id| !is_uuid(id)) { return Err("The diagnostic capture identity is invalid.".to_owned()); }
    let mut capture = recorder().lock().map_err(|_| "Native diagnostics are unavailable.".to_owned())?;
    // Deletion and application share this lock: a pre-clear network response
    // cannot restore its old epoch after the user deletes the window.
    if expected_revision.is_some_and(|revision| revision != CLEAR_REVISION.load(Ordering::Relaxed)) {
        return Ok(capture.health());
    }
    if capture_id.is_some() && capture.capture_id != capture_id { capture.events.clear(); capture.capture_id = capture_id.clone(); }
    ENABLED.store(capture_id.is_some(), Ordering::Relaxed);
    Ok(capture.health())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CapturePolicy { enabled: bool, capture_id: String }

#[tauri::command]
pub(crate) async fn diagnostic_capture_sync(supervisor: tauri::State<'_, crate::harness::HarnessSupervisor>) -> Result<NativeHealth, String> {
    let _single_sync = POLICY_SYNC.lock().await;
    let revision = CLEAR_REVISION.load(Ordering::Relaxed);
    // Read consent from the owner instead of accepting an old window's policy.
    // No recorder lock is held during I/O; a missing owner stops capture.
    let capture_id = async {
        let endpoint = supervisor.get_endpoint()?;
        let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(3)).build().ok()?;
        let response = client.get(format!("{}/api/observations/policy", endpoint.url)).bearer_auth(&endpoint.token).send().await.ok()?;
        if !response.status().is_success() { return None; }
        let text = response.text().await.ok()?;
        let policy: CapturePolicy = serde_json::from_str(&text).ok()?;
        (policy.enabled && is_uuid(&policy.capture_id)).then_some(policy.capture_id)
    }.await;
    let health = configure(capture_id, Some(revision))?;
    if health.enabled { upload_pending(&supervisor).await; }
    Ok(health)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeBatch {
    capture_id: String,
    dropped: u64,
    evicted: u64,
    events: Vec<NativeObservation>,
}

fn pending_batch() -> Option<NativeBatch> {
    let capture = recorder().try_lock().ok()?;
    if !ENABLED.load(Ordering::Relaxed) { return None; }
    let events: Vec<_> = capture.events.iter().filter(|event| event.sequence > capture.delivered_through).take(50).cloned().collect();
    if events.is_empty() { return None; }
    Some(NativeBatch { capture_id: capture.capture_id.clone()?, dropped: DROPPED.load(Ordering::Relaxed), evicted: capture.evicted, events })
}

fn acknowledge(batch: &NativeBatch) {
    if let Ok(mut capture) = recorder().lock() {
        if capture.capture_id.as_deref() == Some(&batch.capture_id) {
            if let Some(last) = batch.events.last() { capture.delivered_through = capture.delivered_through.max(last.sequence); }
        }
    }
}

/// Best-effort loopback delivery. Failed uploads retain the native ring and cursor.
async fn upload_pending(supervisor: &crate::harness::HarnessSupervisor) {
    let Some(batch) = pending_batch() else { return; };
    let Some(endpoint) = supervisor.get_endpoint() else { return; };
    if deliver_batch(&endpoint.url, &endpoint.token, &batch).await { acknowledge(&batch); }
}

async fn deliver_batch(url: &str, token: &str, batch: &NativeBatch) -> bool {
    let Ok(client) = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(3)).build() else { return false; };
    let Ok(body) = serde_json::to_string(batch) else { return false; };
    let Ok(response) = client.post(format!("{url}/api/observations/native"))
        .bearer_auth(token).header("content-type", "application/json").body(body).send().await else { return false; };
    if !response.status().is_success() { return false; }
    let Ok(text) = response.text().await else { return false; };
    #[derive(Deserialize)]
    struct Receipt { accepted: usize, #[serde(default)] stale: bool }
    let Ok(receipt) = serde_json::from_str::<Receipt>(&text) else { return false; };
    !receipt.stale && receipt.accepted <= batch.events.len()
}

#[tauri::command]
pub(crate) fn diagnostic_capture_snapshot() -> Result<NativeSnapshot, String> {
    recorder().lock().map(|capture| capture.snapshot()).map_err(|_| "Native diagnostics are unavailable.".to_owned())
}

#[tauri::command]
pub(crate) fn diagnostic_capture_clear() -> Result<(), String> {
    let mut capture = recorder().lock().map_err(|_| "Native diagnostics are unavailable.".to_owned())?;
    CLEAR_REVISION.fetch_add(1, Ordering::Relaxed);
    capture.events.clear();
    capture.capture_id = None;
    ENABLED.store(false, Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn delivery_sends_the_native_contract_and_requires_a_valid_owner_receipt() {
        let batch = NativeBatch { capture_id: new_uuid(), dropped: 2, evicted: 3, events: vec![NativeObservation {
            v: 1, event_id: new_uuid(), boot_id: new_uuid(), sequence: 7, unix_ms: 12, monotonic_ms: 13,
            name: "native.request", phase: "end", outcome: Some("completed"), operation_id: new_uuid(),
            request_id: Some(new_uuid()), stream_id: None, stage: "response", status: Some(200), duration_ms: Some(4), error_code: None,
        }] };
        for (status, body, expected) in [
            (200, r#"{"accepted":1}"#, true),
            (200, r#"{"accepted":0}"#, true), // A duplicate batch is already retained by the owner.
            (200, r#"{"accepted":1,"stale":true}"#, false),
            (200, r#"{"accepted":2}"#, false),
            (200, "invalid", false),
            (503, r#"{"accepted":1}"#, false),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("fixture listener");
            let address = listener.local_addr().expect("fixture address");
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.expect("fixture connection");
                let mut received = Vec::new();
                let mut buffer = [0_u8; 4096];
                loop {
                    let count = socket.read(&mut buffer).await.expect("fixture request");
                    assert!(count > 0 && received.len() + count < 64 * 1024);
                    received.extend_from_slice(&buffer[..count]);
                    if let Some(offset) = received.windows(4).position(|part| part == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&received[..offset]).to_lowercase();
                        let length = header.lines().find_map(|line| line.strip_prefix("content-length: "))
                            .expect("body length").parse::<usize>().expect("valid body length");
                        if received.len() >= offset + 4 + length { break; }
                    }
                }
                let response = format!("HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                socket.write_all(response.as_bytes()).await.expect("fixture response");
                String::from_utf8(received).expect("UTF-8 request")
            });
            assert_eq!(deliver_batch(&format!("http://{address}"), "fixture-only-token", &batch).await, expected);
            let request = tokio::time::timeout(std::time::Duration::from_secs(5), server).await.expect("fixture completed").expect("fixture task");
            assert!(request.starts_with("POST /api/observations/native HTTP/1.1\r\n"));
            assert!(request.to_lowercase().contains("authorization: bearer fixture-only-token\r\n"));
            let (_, body) = request.split_once("\r\n\r\n").expect("request body");
            let actual: serde_json::Value = serde_json::from_str(body).expect("batch JSON");
            assert_eq!(actual, serde_json::to_value(&batch).expect("batch contract"));
            assert!(!body.contains("fixture-only-token"));
        }
    }
    #[test]
    fn native_storage_is_bounded_and_has_distinct_source_identity() {
        let mut capture = Recorder::new();
        for _ in 0..MAX_EVENTS + 3 {
            capture.push(NativeObservation { v: 1, event_id: new_uuid(), boot_id: String::new(), sequence: 0,
                unix_ms: 1, monotonic_ms: 0, name: "native.harness", phase: "progress", outcome: None,
                operation_id: new_uuid(), request_id: None, stream_id: None, stage: "test", status: None, duration_ms: None, error_code: None });
        }
        let snapshot = capture.snapshot();
        assert_eq!(snapshot.events.len(), MAX_EVENTS);
        assert_eq!(snapshot.health.evicted, 3);
        assert_eq!(snapshot.events[0].sequence, 4);
        assert_eq!(snapshot.events[0].boot_id, snapshot.health.boot_id);
        assert!(is_uuid(&snapshot.events[0].event_id));
    }

    #[test]
    fn clearing_and_reenabling_does_not_resurrect_an_old_operation() {
        configure(Some(new_uuid()), None).expect("enable the fixture");
        let revision = CLEAR_REVISION.load(Ordering::Relaxed);
        let old = NativeSpan::start("native.request", None, None).expect("capture enabled");
        let old_id = old.id.clone();
        let pending = pending_batch().expect("native evidence awaits delivery");
        assert!(pending.events.len() <= 50);
        assert!(pending.events.iter().any(|event| event.operation_id == old_id));
        diagnostic_capture_clear().expect("clear the window");
        let stale = configure(Some(new_uuid()), Some(revision)).expect("stale policy response");
        assert!(!stale.enabled);
        configure(Some(new_uuid()), None).expect("new capture epoch");
        let delivered = recorder().lock().expect("recorder").delivered_through;
        acknowledge(&pending);
        assert_eq!(recorder().lock().expect("recorder").delivered_through, delivered);
        old.finish("completed", Some(200), None);
        assert!(!diagnostic_capture_snapshot().expect("snapshot").events.iter().any(|event| event.operation_id == old_id));
        let before = diagnostic_capture_snapshot().expect("before commands").events.len();
        command_received("diagnostic_capture_sync");
        command_received("service_fetch");
        command_received("service_fetch_bytes");
        command_received("service_stream");
        command_received("get_harness_status");
        command_received("get_harness_endpoint");
        assert_eq!(diagnostic_capture_snapshot().expect("no recursive capture").events.len(), before);
        command_received("open_external_url");
        command_received("untrusted-command-with-private-body");
        let captured = diagnostic_capture_snapshot().expect("command arrivals");
        let commands: Vec<_> = captured.events.iter().filter(|event| event.name == "native.command").collect();
        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0].stage, "open_external_url");
        assert_eq!(commands[1].stage, "unrecognized");
        assert!(commands.iter().all(|event| event.phase == "progress" && event.outcome.is_none() && is_uuid(&event.operation_id)));
        assert_ne!(commands[0].operation_id, commands[1].operation_id);
        assert!(!serde_json::to_string(&captured).expect("command export").contains("private-body"));
        configure(None, None).expect("stop the fixture");
    }
}
