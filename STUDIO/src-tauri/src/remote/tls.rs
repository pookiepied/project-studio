//! HTTPS for the listener, when this machine has a certificate for it.
//!
//! ADR 0050 §3.7 shipped plain HTTP and named the one feature that costs:
//! voice input. A browser refuses the microphone outside a secure context,
//! and a phone reading `http://192.168.1.47:4747` is not one. The client
//! already reads `window.isSecureContext` and greys voice out with the reason
//! (`features/voice/availability.ts`), so the whole change on this side is
//! to *be* a secure context whenever the machine can.
//!
//! "Whenever the machine can" means: a certificate and key the person put
//! there themselves - typically issued by a local CA they trust on their own
//! devices (mkcert or similar). Studio never mints a certificate and never
//! installs trust anywhere; a self-signed certificate it made up would be the
//! full-page browser warning §3.7 rejected.
//!
//! ---- One port, both schemes --------------------------------------------
//!
//! TLS is not a second port. The listener reads the first byte of each
//! connection without consuming it: `0x16` is a TLS handshake record, and
//! anything else is the start of an HTTP request line. So the same address
//! answers `https://` for a device that trusts the certificate and `http://`
//! for one that does not - which keeps working exactly as before, voice greyed
//! out - and no bookmark breaks when a certificate is added or removed.
//!
//! ---- Where the pair is read from ----------------------------------------
//!
//! 1. `PROJECT_STUDIO_REMOTE_TLS_CERT` and `PROJECT_STUDIO_REMOTE_TLS_KEY`,
//!    both set: those files. Pointing them at the files a CA tool refreshes
//!    means a re-issued certificate is picked up at the next switch-on.
//! 2. Otherwise `<studio home>/tls/cert.pem` and `key.pem`, when both exist.
//!
//! Read at each start, never cached across one: switching the feature off and
//! on is how a new certificate takes effect. A pair that is configured but
//! unusable is a log line and a plain-HTTP listener, never a failed start -
//! the address still works, and the voice control still says why it is grey.
//! No path, certificate or key byte is recorded anywhere but that log line's
//! statement that one could not be used.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::net::TcpStream;
use tokio_rustls::rustls;
use tokio_rustls::rustls::pki_types::pem::PemObject;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName};
use tokio_rustls::TlsAcceptor;

const CERT_VARIABLE: &str = "PROJECT_STUDIO_REMOTE_TLS_CERT";
const KEY_VARIABLE: &str = "PROJECT_STUDIO_REMOTE_TLS_KEY";

/// The first byte of every TLS record carrying a handshake (RFC 8446 §5.1).
/// No HTTP/1 request line can begin with it: methods are letters.
const HANDSHAKE_RECORD: u8 = 0x16;

/// A loaded certificate, ready to answer handshakes.
#[derive(Clone)]
pub(crate) struct TlsIdentity {
    acceptor: TlsAcceptor,
    /// The end-entity certificate, kept to answer which printed addresses it
    /// is valid for. Validity is a name match only: whether a device trusts
    /// the issuer is that device's business and cannot be read from here.
    leaf: CertificateDer<'static>,
}

impl TlsIdentity {
    pub(crate) fn acceptor(&self) -> &TlsAcceptor {
        &self.acceptor
    }

    /// Whether a browser would accept this certificate for `host` - an IP
    /// literal or a DNS name, as the settings screen prints it. A host the
    /// certificate does not name is printed as `http://`, because an
    /// `https://` link to it would open on a name-mismatch warning.
    pub(crate) fn covers(&self, host: &str) -> bool {
        let Ok(name) = ServerName::try_from(host) else {
            return false;
        };
        let Ok(parsed) = rustls::server::ParsedCertificate::try_from(&self.leaf) else {
            return false;
        };
        rustls::client::verify_server_name(&parsed, &name).is_ok()
    }
}

/// The pair for this start, if there is one.
///
/// `Ok(None)`: nothing is configured, which is the ordinary case. `Err`: a
/// pair is configured and cannot be used, with a sentence that names neither
/// the path nor any of its content.
pub(crate) fn load() -> Result<Option<TlsIdentity>, String> {
    let Some((cert, key)) = configured_paths(
        std::env::var_os(CERT_VARIABLE).map(PathBuf::from),
        std::env::var_os(KEY_VARIABLE).map(PathBuf::from),
        studio_home().as_deref(),
    )?
    else {
        return Ok(None);
    };
    identity_from_files(&cert, &key).map(Some)
}

/// Which files to read, from the two variables and the Studio home.
///
/// Pure so the rule is testable without touching the process environment.
/// One variable without the other is a mistake worth saying, not a reason to
/// quietly fall back to the home directory's pair.
fn configured_paths(
    cert: Option<PathBuf>,
    key: Option<PathBuf>,
    home: Option<&Path>,
) -> Result<Option<(PathBuf, PathBuf)>, String> {
    let blank = |path: &Option<PathBuf>| path.as_ref().map_or(true, |path| path.as_os_str().is_empty());
    match (blank(&cert), blank(&key)) {
        (false, false) => Ok(cert.zip(key)),
        (true, true) => Ok(home.and_then(|home| {
            let directory = home.join("tls");
            let cert = directory.join("cert.pem");
            let key = directory.join("key.pem");
            (cert.is_file() && key.is_file()).then_some((cert, key))
        })),
        _ => Err(format!(
            "only one of {CERT_VARIABLE} and {KEY_VARIABLE} is set; both are needed"
        )),
    }
}

/// `PROJECT_STUDIO_HOME`, or `~/.studio` - the harness's own rule
/// (`STUDIO HARNESS/src/platform/paths.ts`), restated because this process
/// cannot ask it.
fn studio_home() -> Option<PathBuf> {
    if let Some(configured) = std::env::var_os("PROJECT_STUDIO_HOME") {
        if !configured.is_empty() {
            return Some(PathBuf::from(configured));
        }
    }
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .filter(|home| !home.is_empty())
        .map(|home| PathBuf::from(home).join(".studio"))
}

fn identity_from_files(cert: &Path, key: &Path) -> Result<TlsIdentity, String> {
    let chain = CertificateDer::pem_file_iter(cert)
        .and_then(|certs| certs.collect::<Result<Vec<_>, _>>())
        .map_err(|_| "the certificate file could not be read as PEM".to_owned())?;
    let key = PrivateKeyDer::from_pem_file(key)
        .map_err(|_| "the key file could not be read as a PEM private key".to_owned())?;
    identity(chain, key)
}

fn identity(
    chain: Vec<CertificateDer<'static>>,
    key: PrivateKeyDer<'static>,
) -> Result<TlsIdentity, String> {
    let leaf = chain
        .first()
        .cloned()
        .ok_or_else(|| "the certificate file holds no certificate".to_owned())?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|error| format!("TLS could not be configured: {error}"))?
        .with_no_client_auth()
        // Checks that the key belongs to the certificate, so a mismatched
        // pair fails here rather than at every handshake.
        .with_single_cert(chain, key)
        .map_err(|_| "the key does not belong to the certificate".to_owned())?;
    // HTTP/1.1 only, matching the hyper server behind it.
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(TlsIdentity {
        acceptor: TlsAcceptor::from(Arc::new(config)),
        leaf,
    })
}

/// Whether this connection opens with a TLS handshake, read without consuming
/// a byte. A connection closed before saying anything answers `false`, and
/// the plain path then sees the same end.
pub(crate) async fn opens_with_handshake(stream: &TcpStream) -> io::Result<bool> {
    let mut first = [0u8; 1];
    let read = stream.peek(&mut first).await?;
    Ok(read == 1 && first[0] == HANDSHAKE_RECORD)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A pair for `localhost`, `studio.local`, `127.0.0.1` and
    /// `192.168.1.47`, issued by `CA` the way mkcert issues one. Made for these
    /// tests; the CA's key was discarded, so nothing else can be issued by it.
    pub(crate) const CERT: &str = include_str!("testdata/cert.pem");
    pub(crate) const KEY: &str = include_str!("testdata/key.pem");
    pub(crate) const CA: &str = include_str!("testdata/ca.pem");

    pub(crate) fn test_identity() -> TlsIdentity {
        let chain = CertificateDer::pem_slice_iter(CERT.as_bytes())
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let key = PrivateKeyDer::from_pem_slice(KEY.as_bytes()).unwrap();
        identity(chain, key).unwrap()
    }

    #[test]
    fn the_certificate_covers_exactly_the_hosts_it_names() {
        let identity = test_identity();
        assert!(identity.covers("192.168.1.47"));
        assert!(identity.covers("127.0.0.1"));
        assert!(identity.covers("localhost"));
        assert!(identity.covers("studio.local"));

        // A different address on the same network, a different name, and
        // something that is not a host at all.
        assert!(!identity.covers("192.168.1.48"));
        assert!(!identity.covers("desk.tail1234.ts.net"));
        assert!(!identity.covers("not a host"));
    }

    #[test]
    fn a_key_that_is_not_the_certificates_is_refused_at_load() {
        let chain = CertificateDer::pem_slice_iter(CERT.as_bytes())
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let error = identity(chain, PrivateKeyDer::from_pem_slice(OTHER_KEY.as_bytes()).unwrap())
            .err()
            .expect("a mismatched pair is refused");
        assert_eq!(error, "the key does not belong to the certificate");
    }

    /// A key that belongs to no certificate in this crate.
    const OTHER_KEY: &str = include_str!("testdata/other-key.pem");

    #[test]
    fn unreadable_files_are_a_sentence_without_the_path() {
        let directory = std::env::temp_dir().join(format!("studio-tls-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let cert = directory.join("cert.pem");
        let key = directory.join("key.pem");
        std::fs::write(&cert, "not a certificate").unwrap();
        std::fs::write(&key, KEY).unwrap();

        let error = identity_from_files(&cert, &key).err().expect("garbage is refused");
        assert!(!error.contains(&directory.display().to_string()));
        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn the_variables_win_and_the_home_pair_is_the_fallback() {
        let directory = std::env::temp_dir().join(format!("studio-tls-home-{}", std::process::id()));
        let tls = directory.join("tls");

        // Nothing configured and no home pair: plain HTTP, not an error.
        assert_eq!(configured_paths(None, None, Some(&directory)), Ok(None));
        assert_eq!(configured_paths(None, None, None), Ok(None));

        std::fs::create_dir_all(&tls).unwrap();
        std::fs::write(tls.join("cert.pem"), CERT).unwrap();
        // Half a pair at home is still no pair.
        assert_eq!(configured_paths(None, None, Some(&directory)), Ok(None));
        std::fs::write(tls.join("key.pem"), KEY).unwrap();
        assert_eq!(
            configured_paths(None, None, Some(&directory)),
            Ok(Some((tls.join("cert.pem"), tls.join("key.pem"))))
        );

        // Both variables outrank the home pair.
        let chosen = (PathBuf::from("a.pem"), PathBuf::from("b.pem"));
        assert_eq!(
            configured_paths(Some(chosen.0.clone()), Some(chosen.1.clone()), Some(&directory)),
            Ok(Some(chosen))
        );

        // One variable alone is a mistake to report, not a silent fallback.
        assert!(configured_paths(Some("a.pem".into()), None, Some(&directory)).is_err());
        assert!(configured_paths(None, Some("b.pem".into()), Some(&directory)).is_err());
        // An empty variable counts as unset.
        assert_eq!(
            configured_paths(Some(PathBuf::new()), Some(PathBuf::new()), None),
            Ok(None)
        );

        std::fs::remove_dir_all(&directory).unwrap();
    }
}
