//! Where paired-device credentials live: the operating system's own store.
//!
//! The plan's rule (ADR 0050 §3.4) is that device records are stored with the
//! keyring credential store, never in the SQLite database and never in plain
//! text in app data. The harness's side of that rule is
//! `STUDIO HARNESS/src/credentials/keyring-store.ts`, which writes Windows
//! Credential Manager, macOS Keychain and the Linux Secret Service under the
//! service name `"Project Studio"`. This module is the same facility reached
//! from Rust — the listener lives in this process, and a Node module cannot
//! be reached from it — so both halves of Studio put their secrets in one
//! place a person can see and delete in the ordinary way.
//!
//! Two disciplines are carried over from the Node store rather than
//! reinvented here:
//!
//! - **One entry holds one record.** Windows caps a credential blob at 2560
//!   bytes (measured, not documented — see the Node store's comment), and a
//!   bundle that grows without bound eventually meets the cap it was never
//!   supposed to know exists.
//! - **Platform error text is discarded.** Keyring backends have been
//!   observed to echo the value being stored into their error messages, and
//!   these errors reach log lines. The mapping below keeps only a sentence
//!   that names what failed.

use keyring::Entry;

#[cfg(test)]
use std::collections::HashMap;

/// The service name the harness's keyring store registers. Deliberately the
/// same string, so everything Studio stores appears under one heading in
/// Credential Manager / Keychain Access rather than two.
const SERVICE: &str = "Project Studio";

/// The seam the device store reads and writes through.
///
/// An object rather than a bare function set so that the behaviour above it —
/// pairing, validation, revocation — can be tested without touching the real
/// OS store, exactly as the Node side's `SecureCredentialStore` interface does
/// for its suites.
pub(crate) trait SecretStore: Send + Sync + 'static {
    /// The stored secret, or `None` when nothing is stored under the account.
    fn read(&self, account: &str) -> Result<Option<String>, String>;
    /// Stores the secret, replacing any previous value.
    fn write(&self, account: &str, secret: &str) -> Result<(), String>;
    /// Removes the entry. Removing a missing entry is not an error.
    fn remove(&self, account: &str) -> Result<(), String>;
}

/// The real store.
#[derive(Default)]
pub(crate) struct KeyringStore;

impl KeyringStore {
    fn entry(&self, account: &str) -> Result<Entry, String> {
        Entry::new(SERVICE, account).map_err(|error| {
            // The construction failure names the platform's state, not any
            // value; still, nothing here echoes more than the account name.
            format!("the credential store could not be opened: {error}")
        })
    }
}

impl SecretStore for KeyringStore {
    fn read(&self, account: &str) -> Result<Option<String>, String> {
        match self.entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            // A missing entry is `None`, not a failure; the Node store
            // verified the real Windows store behaves exactly this way.
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("the credential store could not be read.".to_owned()),
        }
    }

    fn write(&self, account: &str, secret: &str) -> Result<(), String> {
        self.entry(account)?
            .set_password(secret)
            .map_err(|_| "the credential store refused the write.".to_owned())
    }

    fn remove(&self, account: &str) -> Result<(), String> {
        match self.entry(account)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("the credential store refused the delete.".to_owned()),
        }
    }
}

/// A store that lives in memory, for the suites of the modules above it.
///
/// Lives here rather than in any one test module because several of them
/// need the same double — `devices` tests pair and reload against it, and
/// `gate` tests drive pairing submissions through it. The write counter
/// exists so tests can pin when persistence does and does not happen.
#[cfg(test)]
pub(crate) struct MemorySecretStore {
    inner: std::sync::Arc<std::sync::Mutex<HashMap<String, String>>>,
    writes: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

#[cfg(test)]
impl MemorySecretStore {
    pub(crate) fn new() -> MemorySecretStore {
        MemorySecretStore {
            inner: std::sync::Arc::new(std::sync::Mutex::new(HashMap::new())),
            writes: std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        }
    }

    /// Another handle over the same entries, for a test that opens a second
    /// `Devices` the way a relaunch of Studio would.
    pub(crate) fn handle(&self) -> Box<dyn SecretStore> {
        Box::new(MemorySecretStore {
            inner: self.inner.clone(),
            writes: self.writes.clone(),
        })
    }

    pub(crate) fn writes(&self) -> usize {
        self.writes.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub(crate) fn entries(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.inner.lock().unwrap()
    }
}

#[cfg(test)]
impl SecretStore for MemorySecretStore {
    fn read(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.entries().get(account).cloned())
    }

    fn write(&self, account: &str, secret: &str) -> Result<(), String> {
        self.writes.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.entries().insert(account.to_owned(), secret.to_owned());
        Ok(())
    }

    fn remove(&self, account: &str) -> Result<(), String> {
        self.entries().remove(account);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trips a value through the real OS store and cleans it up.
    ///
    /// Small and honest rather than mocked: this is the one place this crate
    /// touches a platform API, and the Node side found its actual behaviours
    /// (`None` on missing, `false`-shaped delete) only by using the real
    /// store. A failure here means the environment has no usable credential
    /// store, which is also what it means for the feature itself.
    #[test]
    fn the_real_store_round_trips_a_secret() {
        let store = KeyringStore;
        let account = "remote-device:self-test";

        assert_eq!(store.read(account).unwrap(), None);
        store.write(account, "a secret").unwrap();
        assert_eq!(store.read(account).unwrap().as_deref(), Some("a secret"));
        store.write(account, "a second").unwrap();
        assert_eq!(store.read(account).unwrap().as_deref(), Some("a second"));
        store.remove(account).unwrap();
        store.remove(account).unwrap(); // deleting a missing entry is fine
        assert_eq!(store.read(account).unwrap(), None);
    }
}
