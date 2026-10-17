use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::Manager;
use crate::identity::new_uuid;

const MAX_BYTES: usize = 40 * 1024 * 1024;
static FEED: OnceLock<Mutex<Feed>> = OnceLock::new();

struct Feed {
    path: Option<PathBuf>,
    enabled: bool,
    generation: u64,
    revision: u64,
    id: String,
    status: &'static str,
}

fn feed() -> &'static Mutex<Feed> {
    FEED.get_or_init(|| Mutex::new(Feed { path: None, enabled: false, generation: 0, revision: 0, id: new_uuid(), status: "off" }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InspectorShareStatus { enabled: bool, path: Option<String>, status: &'static str }

impl Feed {
    fn view(&self) -> InspectorShareStatus {
        InspectorShareStatus { enabled: self.enabled, path: self.path.as_ref().map(|path| path.to_string_lossy().into_owned()), status: self.status }
    }

    fn clear(&mut self) -> Result<(), String> {
        self.revision += 1;
        if let Some(path) = &self.path {
            match std::fs::remove_file(path) {
                Ok(()) => (),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => { self.status = "clear_failed"; return Err("The local Inspector feed could not be cleared.".into()); }
            }
        }
        Ok(())
    }

    fn publish(&mut self, generation: u64, revision: u64, body: &[u8], status: &'static str) -> Result<bool, String> {
        if !self.enabled || generation != self.generation || revision != self.revision { return Ok(false); }
        if body.len() > MAX_BYTES { self.status = "snapshot_limit"; return Err("The local Inspector snapshot exceeds its bound.".into()); }
        let path = self.path.as_ref().ok_or("The local Inspector feed is unavailable.")?;
        let parent = path.parent().ok_or("The local Inspector feed is unavailable.")?;
        if std::fs::create_dir_all(parent).is_err() {
            self.status = "write_failed";
            return Err("The local Inspector feed directory is unavailable.".into());
        }
        let temporary = parent.join(format!("inspector-{}.tmp", new_uuid()));
        let write = || -> std::io::Result<()> {
            use std::io::Write;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
            let mut file = options.open(&temporary)?;
            file.write_all(body)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temporary, path)
        };
        if write().is_err() {
            let _ = std::fs::remove_file(&temporary);
            self.status = "write_failed";
            return Err("The local Inspector feed could not be written.".into());
        }
        self.status = status;
        Ok(true)
    }
}

pub(crate) fn initialize(app: &tauri::AppHandle) {
    if let Ok(mut state) = feed().lock() {
        state.path = app.path().app_data_dir().ok().map(|path| path.join("inspector-feed.json"));
        let _ = state.clear();
    }
}

pub(crate) fn clear_snapshot() {
    if let Ok(mut state) = feed().lock() { let _ = state.clear(); }
}

pub(crate) fn shutdown() {
    if let Ok(mut state) = feed().lock() {
        state.enabled = false; state.generation += 1; state.status = "off";
        let _ = state.clear();
    }
}

#[tauri::command]
pub(crate) fn diagnostic_inspector_status() -> Result<InspectorShareStatus, String> {
    feed().lock().map(|state| state.view()).map_err(|_| "The local Inspector feed is unavailable.".into())
}

#[tauri::command]
pub(crate) async fn diagnostic_inspector_configure(app: tauri::AppHandle, enabled: bool) -> Result<InspectorShareStatus, String> {
    let generation = {
        let mut state = feed().lock().map_err(|_| "The local Inspector feed is unavailable.")?;
        if state.enabled == enabled { return Ok(state.view()); }
        if enabled && state.path.is_none() { return Err("The local Inspector feed directory is unavailable.".into()); }
        state.enabled = enabled; state.generation += 1; state.id = new_uuid();
        state.status = if enabled { "waiting" } else { "off" };
        if let Err(error) = state.clear() { state.enabled = false; return Err(error); }
        state.generation
    };
    if enabled {
        tauri::async_runtime::spawn(async move {
            loop {
                let active = feed().lock().ok().and_then(|state| (state.enabled && state.generation == generation).then(|| (state.revision, state.id.clone())));
                let Some((revision, id)) = active else { break; };
                let endpoint = app.try_state::<crate::harness::HarnessSupervisor>().and_then(|owner| owner.get_endpoint());
                let mut frame = match endpoint {
                    Some(endpoint) => snapshot(&endpoint.url, &endpoint.token).await.unwrap_or_else(|_| json!({ "status": "unavailable" })),
                    None => json!({ "status": "unavailable" }),
                };
                let status = match frame["status"].as_str() { Some("ready") => "ready", Some("paused") => "paused", _ => "unavailable" };
                frame["format"] = json!("project-studio.inspector-feed"); frame["version"] = json!(1);
                frame["feedId"] = json!(id); frame["snapshotId"] = json!(new_uuid());
                frame["writtenAtUnixMs"] = json!(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis().min(u64::MAX as u128) as u64);
                if let Ok(native) = crate::diagnostics::diagnostic_capture_snapshot() {
                    frame["native"] = serde_json::to_value(native).unwrap_or(Value::Null);
                }
                if let Ok(body) = serde_json::to_vec(&frame) {
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        if let Ok(mut state) = feed().lock() { let _ = state.publish(generation, revision, &body, status); }
                    }).await;
                }
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            }
        });
    }
    diagnostic_inspector_status()
}

async fn read_json(client: &reqwest::Client, url: String, token: &str, bound: usize) -> Result<Value, ()> {
    let mut response = client.get(url).bearer_auth(token).header("x-project-studio-request-id", new_uuid()).send().await.map_err(|_| ())?;
    if !response.status().is_success() { return Err(()); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if bytes.len() + chunk.len() > bound { return Err(()); }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| ())
}

/// Fixed, admitted GETs only. The owner credential never enters the exported frame.
async fn snapshot(url: &str, token: &str) -> Result<Value, ()> {
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(3)).build().map_err(|_| ())?;
    let health = read_json(&client, format!("{url}/api/diagnostics"), token, 65536).await?;
    let boot = health["bootId"].as_str().filter(|id| crate::identity::is_uuid(id)).ok_or(())?;
    let latest = health["latestSequence"].as_u64().ok_or(())?;
    let mut after = 0; let mut events = Vec::new(); let mut gap = false; let mut bytes = 0;
    for _ in 0..20 {
        let page = read_json(&client, format!("{url}/api/diagnostics/events?after={after}&limit=500&bootId={boot}"), token, MAX_BYTES).await?;
        if page["health"]["bootId"] != health["bootId"] || page["health"]["captureId"] != health["captureId"] || page["health"]["policy"] != health["policy"] { return Err(()); }
        gap |= page["gap"] == true;
        let batch = page["events"].as_array().ok_or(())?;
        for event in batch {
            if event["sequence"].as_u64().ok_or(())? > latest { continue; }
            bytes += serde_json::to_vec(event).map_err(|_| ())?.len();
            if bytes > 33 * 1024 * 1024 || events.len() >= 10_000 { return Err(()); }
            events.push(event.clone());
        }
        let next = page["nextSequence"].as_u64().ok_or(())?;
        if batch.is_empty() || next <= after || next >= latest { break; }
        after = next;
    }
    let current = read_json(&client, format!("{url}/api/diagnostics"), token, 65536).await?;
    if current["bootId"] != health["bootId"] || current["captureId"] != health["captureId"] || current["policy"] != health["policy"] { return Err(()); }
    Ok(json!({ "status": "ready", "health": health, "gap": gap, "events": events }))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn server(replies: Vec<Value>) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("isolated listener");
        listener.set_nonblocking(true).expect("nonblocking");
        let address = listener.local_addr().expect("address");
        let task = std::thread::spawn(move || {
            for reply in replies {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && std::time::Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(5)),
                        Err(error) => panic!("fixture accept: {error}"),
                    }
                };
                stream.set_read_timeout(Some(std::time::Duration::from_secs(3))).expect("timeout");
                let mut request = Vec::new();
                let mut byte = [0_u8; 1];
                while !request.ends_with(b"\r\n\r\n") && request.len() < 8192 {
                    stream.read_exact(&mut byte).expect("request"); request.push(byte[0]);
                }
                let request = String::from_utf8(request).expect("ASCII request");
                assert!(request.starts_with("GET /api/diagnostics"));
                assert!(request.to_lowercase().contains("authorization: bearer fixture-owner\r\n"));
                assert!(request.to_lowercase().contains("x-project-studio-request-id:"));
                let body = serde_json::to_string(&reply).expect("fixture JSON");
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{}", body.len(), body).expect("response");
            }
        });
        (format!("http://{address}"), task)
    }

    #[tokio::test]
    async fn snapshot_reads_admitted_pages_and_rejects_changed_capture_epochs() {
        let health = json!({ "bootId": new_uuid(), "captureId": new_uuid(), "policy": { "enabled": true }, "latestSequence": 2 });
        let page = json!({ "health": health, "events": [{ "sequence": 1 }, { "sequence": 2 }, { "sequence": 3 }], "nextSequence": 3, "gap": true });
        let (url, task) = server(vec![health.clone(), page.clone(), health.clone()]).await;
        let result = snapshot(&url, "fixture-owner").await.expect("snapshot");
        task.join().expect("server");
        assert_eq!(result["events"].as_array().expect("events").len(), 2);
        assert_eq!(result["gap"], true);
        assert!(!result.to_string().contains("fixture-owner"));
        let mut changed = health.clone(); changed["captureId"] = json!(new_uuid());
        let (url, task) = server(vec![health, page, changed]).await;
        assert!(snapshot(&url, "fixture-owner").await.is_err()); task.join().expect("server");
    }

    #[tokio::test]
    async fn stopped_capture_can_share_its_retained_window_without_enabling_recording() {
        let health = json!({ "bootId": new_uuid(), "captureId": new_uuid(), "policy": { "enabled": false }, "latestSequence": 1 });
        let (url, task) = server(vec![health.clone(), json!({ "health": health, "events": [{ "sequence": 1 }], "nextSequence": 1 }), health]).await;
        let result = snapshot(&url, "fixture-owner").await.expect("retained snapshot");
        task.join().expect("server");
        assert_eq!(result["status"], "ready"); assert_eq!(result["health"]["policy"]["enabled"], false);
        assert_eq!(result["events"].as_array().expect("retained events").len(), 1);
    }

    #[tokio::test]
    async fn actual_native_snapshot_file_is_collectable_through_read_only_mcp() {
        let boot = new_uuid();
        let health = json!({ "bootId": boot, "captureId": new_uuid(), "policy": { "enabled": true }, "latestSequence": 1 });
        let event = json!({ "v": 1, "eventId": new_uuid(), "bootId": boot, "sequence": 1,
            "timestamp": "2026-10-17T00:00:00.000Z", "monotonicMs": 1, "name": "runtime.turn", "phase": "end",
            "outcome": "completed", "identity": { "conversationId": "conversation", "operationId": new_uuid() },
            "attributes": {}, "contentState": "absent" });
        let (url, task) = server(vec![health.clone(), json!({ "health": health, "events": [event], "nextSequence": 1, "gap": false }), health]).await;
        let mut frame = snapshot(&url, "fixture-owner").await.expect("native HTTP snapshot"); task.join().expect("server");
        frame["format"] = json!("project-studio.inspector-feed"); frame["version"] = json!(1);
        frame["feedId"] = json!(new_uuid()); frame["snapshotId"] = json!(new_uuid());
        let root = std::env::temp_dir().join(format!("studio-inspector-{}", new_uuid()));
        let path = root.join("feed.json");
        let mut state = Feed { path: Some(path.clone()), enabled: true, generation: 1, revision: 0, id: new_uuid(), status: "waiting" };
        assert!(state.publish(1, 0, &serde_json::to_vec(&frame).expect("JSON"), "ready").expect("atomic publication"));
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../studio-inspector/tests/native-feed.test.mjs");
        let result = std::process::Command::new("node").arg("--test").arg(script)
            .env("STUDIO_INSPECTOR_TEST_FEED", &path).output().expect("Node fixture");
        state.clear().expect("clear"); std::fs::remove_dir(root).expect("isolated directory");
        assert!(result.status.success(), "{} {}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
    }

    #[test]
    fn sharing_is_opt_in_and_old_writers_cannot_restore_cleared_content() {
        let root = std::env::temp_dir().join(format!("studio-inspector-{}", new_uuid()));
        let path = root.join("feed.json");
        let mut state = Feed { path: Some(path.clone()), enabled: false, generation: 1, revision: 0, id: new_uuid(), status: "off" };
        assert!(!state.publish(1, 0, b"old", "ready").expect("disabled"));
        assert!(!path.exists());
        state.enabled = true;
        assert!(state.publish(1, 0, b"first complete snapshot", "ready").expect("publish"));
        assert_eq!(std::fs::read(&path).expect("read"), b"first complete snapshot");
        state.clear().expect("clear");
        assert!(!state.publish(1, 0, b"old", "ready").expect("late writer"));
        assert!(!path.exists());
        assert!(state.publish(1, 1, b"new snapshot", "ready").expect("new writer"));
        state.enabled = false; state.generation += 1; state.clear().expect("stop");
        assert!(!state.publish(1, 1, b"old", "ready").expect("stopped"));
        assert!(!path.exists());
        std::fs::remove_dir(root).expect("isolated directory");
    }
}
