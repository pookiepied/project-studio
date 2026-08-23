use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};

const CREDENTIAL_BYTES: usize = 32;

/// The frame written into the child over the bootstrap pipe.
///
/// The two renames are a contract with the patched Flue entrypoint
/// (`STUDIO HARNESS/patches/@flue__cli@1.0.0-beta.9.patch`), which reads
/// `bootstrap.clientId` and `bootstrap.sessionId` and throws
/// `[flue] Invalid Project Studio admission bootstrap.` for anything else.
/// Without them Rust emitted `client_id`/`session_id`, and the Harness died
/// during module evaluation on every launch -- the whole port, working, right
/// up to the point where a Harness actually ran. `endpoint.rs` renames the same
/// two fields in the other direction, for the same reason.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdmissionBootstrap {
    pub credential: String,
    #[serde(rename = "clientId")]
    pub client_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

#[derive(Debug, Clone)]
pub struct GeneratedBootstrap {
    pub bootstrap: AdmissionBootstrap,
    pub credential_raw: String,
}

pub fn generate_bootstrap(client_id: String) -> GeneratedBootstrap {
    let mut bytes = [0u8; CREDENTIAL_BYTES];
    rand::thread_rng().fill_bytes(&mut bytes);
    let credential = URL_SAFE_NO_PAD.encode(bytes);
    let session_id = uuid_like();
    let bootstrap = AdmissionBootstrap {
        credential: credential.clone(),
        client_id: client_id.clone(),
        session_id: session_id.clone(),
    };
    GeneratedBootstrap {
        bootstrap,
        credential_raw: credential,
    }
}

fn uuid_like() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    // Simple v4-like formatting without extra crate
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The three names the Node entrypoint reads, spelled its way.
    ///
    /// Asserted on the serialized form rather than the struct, because the
    /// struct's field names are the ones that were wrong and a test written
    /// against them would have agreed with the bug.
    #[test]
    fn the_bootstrap_frame_uses_the_names_the_node_entrypoint_reads() {
        let b = generate_bootstrap("studio-host".to_string());
        let json: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&b.bootstrap).unwrap()).unwrap();
        let object = json.as_object().expect("an object");

        assert_eq!(object.get("clientId").and_then(|v| v.as_str()), Some("studio-host"));
        assert!(object.get("sessionId").and_then(|v| v.as_str()).is_some());
        assert!(object.get("credential").and_then(|v| v.as_str()).is_some());
        assert!(!object.contains_key("client_id"), "snake_case is not the wire format");
        assert!(!object.contains_key("session_id"), "snake_case is not the wire format");
    }

    #[test]
    fn credential_is_base64url_and_long_enough() {
        let b = generate_bootstrap("studio-host".to_string());
        assert!(b.credential_raw.len() >= 43);
        assert!(b.credential_raw.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }
}
