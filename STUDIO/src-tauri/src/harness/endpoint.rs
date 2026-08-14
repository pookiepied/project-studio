use serde::{Deserialize, Serialize};

const READINESS_TYPE: &str = "project-studio.harness.ready";
const READINESS_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HarnessReadiness {
    #[serde(rename = "type")]
    pub readiness_type: String,
    pub version: u32,
    pub pid: u32,
    pub host: String,
    pub port: u16,
    #[serde(rename = "clientId")]
    pub client_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HarnessEndpoint {
    pub host: String,
    pub port: u16,
    pub pid: u32,
    pub url: String,
    #[serde(rename = "clientId")]
    pub client_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    /// Per-launch bearer. Only returned to the trusted webview; never logged.
    pub token: String,
}

impl HarnessEndpoint {
    pub fn from_readiness(readiness: HarnessReadiness, token: String) -> Option<Self> {
        if readiness.readiness_type != READINESS_TYPE
            || readiness.version != READINESS_VERSION
            || readiness.host != "127.0.0.1"
            || readiness.port == 0
        {
            return None;
        }
        let url = format!("http://{}:{}", readiness.host, readiness.port);
        Some(Self {
            host: readiness.host,
            port: readiness.port,
            pid: readiness.pid,
            url,
            client_id: readiness.client_id,
            session_id: readiness.session_id,
            token,
        })
    }
}

pub fn parse_readiness_line(line: &str) -> Option<HarnessReadiness> {
    let parsed: serde_json::Value = serde_json::from_str(line).ok()?;
    let obj = parsed.as_object()?;
    if obj.get("type")?.as_str()? != READINESS_TYPE {
        return None;
    }
    if obj.get("version")?.as_u64()? != u64::from(READINESS_VERSION) {
        return None;
    }
    let host = obj.get("host")?.as_str()?.to_string();
    if host != "127.0.0.1" {
        return None;
    }
    let port = obj.get("port")?.as_u64()? as u16;
    if port == 0 {
        return None;
    }
    let pid = obj.get("pid")?.as_u64()? as u32;
    if pid == 0 {
        return None;
    }
    let client_id = obj.get("clientId")?.as_str()?.to_string();
    let session_id = obj.get("sessionId")?.as_str()?.to_string();
    if client_id.is_empty() || session_id.is_empty() {
        return None;
    }
    Some(HarnessReadiness {
        readiness_type: READINESS_TYPE.to_string(),
        version: READINESS_VERSION,
        pid,
        host,
        port,
        client_id,
        session_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_loopback() {
        let line = serde_json::json!({
            "type": "project-studio.harness.ready",
            "version": 1,
            "pid": 123,
            "host": "0.0.0.0",
            "port": 3000,
            "clientId": "a",
            "sessionId": "b"
        }).to_string();
        assert!(parse_readiness_line(&line).is_none());
    }

    #[test]
    fn accepts_valid() {
        let line = serde_json::json!({
            "type": "project-studio.harness.ready",
            "version": 1,
            "pid": 123,
            "host": "127.0.0.1",
            "port": 3000,
            "clientId": "studio-host",
            "sessionId": "sess"
        }).to_string();
        let r = parse_readiness_line(&line).unwrap();
        assert_eq!(r.port, 3000);
    }
}
