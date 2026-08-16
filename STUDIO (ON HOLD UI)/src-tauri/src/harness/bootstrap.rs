use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};

const CREDENTIAL_BYTES: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdmissionBootstrap {
    pub credential: String,
    pub client_id: String,
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

    #[test]
    fn credential_is_base64url_and_long_enough() {
        let b = generate_bootstrap("studio-host".to_string());
        assert!(b.credential_raw.len() >= 43);
        assert!(b.credential_raw.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }
}
