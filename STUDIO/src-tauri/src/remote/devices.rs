//! Paired devices: who may talk to the listener, and how that is revoked.
//!
//! A paired browser carries a cookie of the form `{device id}.{secret}`. The
//! secret itself is generated once at pairing and shown to nobody — not even
//! the person — and is stored only as its SHA-256. A copy of the credential
//! store therefore does not admit anything; only the browser that received
//! the cookie at pairing time holds a value that hashes to the stored
//! digest. Validation compares digests in constant time, on the same
//! reasoning the harness's admission verifier states: hashing both values
//! gives fixed-size inputs and removes the length channel.
//!
//! ---- One record, one entry ---------------------------------------------
//!
//! Each device is one keyring entry (`remote-device:{id}`), and a small index
//! entry (`remote-device:index`) lists the ids. The index exists because the
//! keyring APIs Studio targets cannot enumerate the entries under a service;
//! without it there is no way to know what devices exist. It is metadata,
//! not a credential: losing it loses only the list, and records that the
//! index names but cannot be read are dropped rather than treated as an
//! error, so a half-written state degrades to "that device unpaired" and not
//! to a listener that refuses to start.
//!
//! Nothing here is ever written to the SQLite database or to a plain file in
//! app data (ADR 0050 §3.4), and the secret is never present in the record —
//! only its digest.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::watch;

use super::secret_store::SecretStore;

/// How long a paired device's cookie lives: one year. A device the person no
/// longer uses is removed from the list, not aged out — expiry is what an
/// unattended credential needs, and a year is long enough that an active
/// device never notices it.
const COOKIE_MAX_AGE_SECS: u64 = 365 * 24 * 60 * 60;

/// How stale a device's `last seen` may get before a request rewrites it.
///
/// Every request would otherwise pay a credential-store write, which is both
/// slow and, on Windows, a visible update in Credential Manager for a fact
/// nobody looks at more coarsely than "when did I last use this". One minute
/// is far below anything the settings screen presents as a time.
const LAST_SEEN_WRITE_THROTTLE_MS: u64 = 60 * 1000;

/// The longest name a device may carry. A name is displayed in a list and
/// edited by the person; this is a bound against accidental bulk, not a
/// security measure.
const MAX_NAME_CHARS: usize = 60;

pub(crate) const COOKIE_NAME: &str = "studio_device";

/// What the settings screen shows about one device. Never carries the secret
/// or its digest: neither is a fact a person needs.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct DeviceView {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) paired_at_ms: u64,
    pub(crate) last_seen_ms: u64,
}

/// What a successful pairing hands back: the cookie to hand out.
///
/// The new device itself reaches the settings screen through `list()` — the
/// list is the one view of the devices, and a second copy of a record here
/// would be a second thing to keep current.
pub(crate) struct PairedDevice {
    /// The full cookie value: `{id}.{secret}`.
    pub(crate) cookie: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredRecord {
    name: String,
    /// Hex-encoded SHA-256 of the cookie secret. The secret itself is never
    /// persisted anywhere.
    secret_hash: String,
    paired_at_ms: u64,
    last_seen_ms: u64,
}

/// The store as the rest of the app holds it.
///
/// The keyring is the durable copy; this in-memory map is the working set,
/// loaded once at startup so a validation is not a credential-store read per
/// request. Every mutation writes through immediately, except `last_seen`,
/// which is throttled — it is the one field whose precision nobody needs.
pub(crate) struct Devices {
    store: Box<dyn SecretStore>,
    inner: Mutex<Inner>,
}

struct Inner {
    devices: HashMap<String, DeviceRecord>,
    /// The revocation signal per device. A request that validates subscribes
    /// to its device's channel, and `revoke` fires it — which ends every
    /// connection that device holds, including a stream mid-read, instead of
    /// waiting for the device's next request to discover the removal.
    live: HashMap<String, watch::Sender<bool>>,
}

#[derive(Clone)]
struct DeviceRecord {
    name: String,
    secret_hash: [u8; 32],
    paired_at_ms: u64,
    last_seen_ms: u64,
}

impl Devices {
    /// Opens the store and loads every device it lists.
    ///
    /// Deliberately tolerant, and deliberately silent about writing: a record
    /// the index names but that cannot be read or parsed is dropped (as far
    /// as this process is concerned, that device unpaired itself), and a
    /// corrupt index degrades to an empty list. Nothing is written at load
    /// time; the index repairs itself on the next mutation, from the state
    /// that actually loaded.
    pub(crate) fn open(store: Box<dyn SecretStore>) -> Devices {
        let index = store
            .read(INDEX_ACCOUNT)
            .ok()
            .flatten()
            .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
            .unwrap_or_default();

        let mut devices = HashMap::new();
        for id in index {
            let Some(text) = store.read(&record_account(&id)).ok().flatten() else {
                continue;
            };
            let Ok(stored) = serde_json::from_str::<StoredRecord>(&text) else {
                continue;
            };
            let Ok(secret_hash) = decode_digest(&stored.secret_hash) else {
                continue;
            };
            devices.insert(
                id,
                DeviceRecord {
                    name: stored.name,
                    secret_hash,
                    paired_at_ms: stored.paired_at_ms,
                    last_seen_ms: stored.last_seen_ms,
                },
            );
        }

        // Restored cookies need the same revocation channel as newly paired ones.
        let live = devices.keys().map(|id| {
            let (sender, _) = watch::channel(false);
            (id.clone(), sender)
        }).collect();
        Devices {
            store,
            inner: Mutex::new(Inner {
                devices,
                live,
            }),
        }
    }

    /// Whether the credential store can actually be reached, by round-tripping
    /// a probe entry — the same check `isKeyringAvailable` performs on the
    /// Node side. The listener must not bind to the network on a machine
    /// where pairing cannot work: an unpairable listener is one that is
    /// either useless (everything refused) or, worse, tempting to weaken.
    pub(crate) fn available(&self) -> bool {
        const PROBE_ACCOUNT: &str = "remote-device:availability-probe";
        self.store.write(PROBE_ACCOUNT, "probe").is_ok()
            && self.store.remove(PROBE_ACCOUNT).is_ok()
    }

    /// Pairs a device: mints its secret, stores the record, and returns the
    /// cookie value to hand out.
    ///
    /// The caller has already checked the pairing code and the rate limit;
    /// this is the step that cannot be allowed to half-happen, so the record
    /// is written to the store before it is admitted here. A store failure
    /// leaves the device unpaired in memory too.
    pub(crate) fn pair(&self, name: &str, now_ms: u64) -> Result<PairedDevice, String> {
        let id = format!("pd_{}", hex(&random_bytes(8)));
        let secret = base64_url(&random_bytes(32));
        let record = DeviceRecord {
            name: clean_name(name),
            secret_hash: Sha256::digest(secret.as_bytes()).into(),
            paired_at_ms: now_ms,
            last_seen_ms: now_ms,
        };

        let mut inner = self.lock();
        self.persist_raw(&id, &record_snapshot(&record))?;
        let mut ids: Vec<String> = inner.devices.keys().cloned().collect();
        ids.push(id.clone());
        if let Err(error) = self.write_index(ids) {
            let _ = self.store.remove(&record_account(&id));
            return Err(error);
        }
        inner.devices.insert(id.clone(), record);
        let (sender, _) = watch::channel(false);
        inner.live.insert(id.clone(), sender);
        log::info!("Remote access: paired a device ({id})");

        Ok(PairedDevice {
            cookie: format!("{id}.{secret}"),
        })
    }

    /// Validates a device cookie and returns the signal that fires if the
    /// device is revoked while its request is in flight.
    ///
    /// Every failure is a sentence for the log; what reaches the device is
    /// one refusal, because which part failed is a detail for the person who
    /// owns the machine, not for whatever presented the cookie.
    pub(crate) fn authorize(
        &self,
        cookie: &str,
        now_ms: u64,
    ) -> Result<watch::Receiver<bool>, String> {
        let Some((id, secret)) = cookie.split_once('.') else {
            return Err("the cookie is not a device credential.".to_owned());
        };

        let mut inner = self.lock();
        // The sender is cloned before the record is looked up, so the two
        // map borrows never overlap through the guard. Cloning is all the
        // subscription needs: it lands on the same channel state.
        let sender = inner
            .live
            .get(id)
            .ok_or_else(|| "no such device.".to_owned())?
            .clone();
        let Some(record) = inner.devices.get_mut(id) else {
            return Err("no such device.".to_owned());
        };

        let presented: [u8; 32] = Sha256::digest(secret.as_bytes()).into();
        if !digests_equal(&presented, &record.secret_hash) {
            return Err("the credential does not match.".to_owned());
        }

        let revoked = sender.subscribe();

        // `last_seen` is written through at most once a minute; the record's
        // own field is the throttle, because it is the value that was last
        // persisted. The write happens under the lock so a concurrent revoke
        // cannot remove the record and then be followed by this write
        // re-persisting it.
        if now_ms.saturating_sub(record.last_seen_ms) > LAST_SEEN_WRITE_THROTTLE_MS {
            record.last_seen_ms = now_ms;
            let snapshot = record_snapshot(record);
            if let Err(error) = self.persist_raw(id, &snapshot) {
                // In memory the timestamp has already moved; a store that
                // will not take a courtesy timestamp is not a reason to
                // refuse a valid device. The next successful write carries
                // the newer value forward.
                log::debug!("Remote access: could not record last seen: {error}");
            }
        }

        Ok(revoked)
    }

    /// Every device, for the settings screen.
    pub(crate) fn list(&self) -> Vec<DeviceView> {
        let inner = self.lock();
        let mut devices: Vec<DeviceView> = inner
            .devices
            .iter()
            .map(|(id, record)| DeviceView {
                id: id.clone(),
                name: record.name.clone(),
                paired_at_ms: record.paired_at_ms,
                last_seen_ms: record.last_seen_ms,
            })
            .collect();
        devices.sort_by_key(|device| device.paired_at_ms);
        devices
    }

    /// Renames a device. The name is display text and nothing else.
    pub(crate) fn rename(&self, id: &str, name: &str) -> Result<(), String> {
        let mut inner = self.lock();
        let Some(record) = inner.devices.get_mut(id) else {
            return Err("no such device.".to_owned());
        };
        let mut updated = record.clone();
        updated.name = clean_name(name);
        self.persist_raw(id, &record_snapshot(&updated))?;
        *record = updated;
        Ok(())
    }

    /// Removes a device, answering whether there was one to remove.
    ///
    /// Persist the index exclusion before confirming removal. Then close live
    /// requests and delete the now-unreferenced record on a best-effort basis.
    pub(crate) fn revoke(&self, id: &str) -> Result<bool, String> {
        let mut inner = self.lock();
        if !inner.devices.contains_key(id) { return Ok(false); }
        // Persist the exclusion first. A failed write leaves a visible device
        // the person can retry, rather than a successful removal that revives.
        self.write_index(inner.devices.keys().filter(|key| key.as_str() != id).cloned().collect())?;
        inner.devices.remove(id);
        if let Some(sender) = inner.live.remove(id) { let _ = sender.send(true); }
        let _ = self.store.remove(&record_account(id));
        log::info!("Remote access: removed a device ({id})");
        Ok(true)
    }

    /// Removes every device. Answers with how many there were.
    pub(crate) fn revoke_all(&self) -> Result<usize, String> {
        let ids: Vec<String> = {
            let mut inner = self.lock();
            self.write_index(Vec::new())?;
            for (_, sender) in inner.live.drain() {
                let _ = sender.send(true);
            }
            let ids: Vec<String> = inner.devices.keys().cloned().collect();
            for id in &ids {
                // Best-effort deletes: as in `revoke`, an entry that survives
                // is inert, because the index below no longer names it.
                if let Err(error) = self.store.remove(&record_account(id)) {
                    log::warn!("Remote access: could not delete a stored device record: {error}");
                }
            }
            inner.devices.clear();
            ids
        };
        log::info!("Remote access: removed {} device(s)", ids.len());
        Ok(ids.len())
    }

    fn persist_raw(&self, id: &str, record: &StoredRecord) -> Result<(), String> {
        let text = serde_json::to_string(record)
            .map_err(|_| "the device record could not be serialised.".to_owned())?;
        self.store.write(&record_account(id), &text)
    }

    /// Writes the prospective index while the caller holds the device lock.
    fn write_index(&self, mut ids: Vec<String>) -> Result<(), String> {
        ids.sort();
        let text = serde_json::to_string(&ids)
            .map_err(|_| "the device index could not be serialised.".to_owned())?;
        self.store.write(INDEX_ACCOUNT, &text)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The `Set-Cookie` value for a freshly paired device.
///
/// `HttpOnly` keeps the value away from page scripts; `SameSite=Strict` keeps
/// it out of every cross-site request, which is the CSRF defence this design
/// relies on; `Secure` is deliberately absent, because the listener speaks
/// plain HTTP and a cookie a browser refuses to store would break pairing on
/// the network it serves (ADR 0050 §3.7 — TLS is Tailscale's job).
pub(crate) fn set_cookie_value(value: &str) -> String {
    format!(
        "{COOKIE_NAME}={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={COOKIE_MAX_AGE_SECS}"
    )
}

const INDEX_ACCOUNT: &str = "remote-device:index";

fn record_account(id: &str) -> String {
    format!("remote-device:{id}")
}

fn record_snapshot(record: &DeviceRecord) -> StoredRecord {
    StoredRecord {
        name: record.name.clone(),
        secret_hash: hex(&record.secret_hash),
        paired_at_ms: record.paired_at_ms,
        last_seen_ms: record.last_seen_ms,
    }
}

fn random_bytes(length: usize) -> Vec<u8> {
    use rand::RngCore;
    let mut bytes = vec![0_u8; length];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_digest(text: &str) -> Result<[u8; 32], ()> {
    if text.len() != 64 {
        return Err(());
    }
    let mut digest = [0_u8; 32];
    for (index, pair) in text.as_bytes().chunks(2).enumerate() {
        let high = (*pair.first().ok_or(())? as char).to_digit(16).ok_or(())?;
        let low = (*pair.last().ok_or(())? as char).to_digit(16).ok_or(())?;
        digest[index] = ((high << 4) | low) as u8;
    }
    Ok(digest)
}

/// Compares two digests without spending an early exit on the first
/// difference. The loop keeps its shape for every input; only the final fold
/// reveals anything.
///
/// Shared with `pairing.rs`, whose code comparison is the same operation on
/// the same reasoning — one definition of a constant-time compare, not two
/// that can drift.
pub(crate) fn digests_equal(a: &[u8; 32], b: &[u8; 32]) -> bool {
    a.iter()
        .zip(b.iter())
        .fold(0_u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

/// A device name a person would recognise, trimmed to what a list can show.
///
/// Control characters are dropped rather than escaped-with-a-hope: this text
/// lands in JSON, in a keyring entry, and on a screen.
fn clean_name(name: &str) -> String {
    let cleaned: String = name.chars().filter(|c| !c.is_control()).collect();
    let trimmed = cleaned.trim();
    if trimmed.chars().count() > MAX_NAME_CHARS {
        trimmed.chars().take(MAX_NAME_CHARS).collect()
    } else {
        trimmed.to_owned()
    }
}

fn base64_url(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Now, in the units the records keep time in.
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FailingStore {
        backing: Box<dyn SecretStore>,
        fail_write: std::sync::Arc<std::sync::atomic::AtomicBool>,
        fail_delete: bool,
        index_only: bool,
    }

    impl SecretStore for FailingStore {
        fn read(&self, account: &str) -> Result<Option<String>, String> { self.backing.read(account) }
        fn write(&self, account: &str, value: &str) -> Result<(), String> {
            if self.fail_write.load(std::sync::atomic::Ordering::SeqCst) && (!self.index_only || account == INDEX_ACCOUNT) {
                Err("The credential store refused the write.".to_owned())
            } else { self.backing.write(account, value) }
        }
        fn remove(&self, account: &str) -> Result<(), String> {
            if self.fail_delete { Err("The credential store refused the delete.".to_owned()) }
            else { self.backing.remove(account) }
        }
    }

    #[test]
    fn persistence_failures_are_reported_and_do_not_fake_device_changes() {
        let store = memory_store();
        let failed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let devices = Devices::open(Box::new(FailingStore { backing: store.handle(), fail_write: failed.clone(), fail_delete: true, index_only: false }));
        let paired = devices.pair("Phone", 1_000).unwrap();
        let id = the_only_device(&devices);
        let signal = devices.authorize(&paired.cookie, 1_100).unwrap();
        failed.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(devices.rename(&id, "Changed").is_err());
        assert_eq!(devices.list()[0].name, "Phone");
        assert!(devices.revoke(&id).is_err());
        assert!(devices.revoke_all().is_err());
        assert!(!*signal.borrow());
        assert_eq!(devices.list().len(), 1);
        failed.store(false, std::sync::atomic::Ordering::SeqCst);
        devices.revoke(&id).unwrap();
        assert!(*signal.borrow());
        // Even if record deletion fails, the persisted index excludes it.
        let restored = Devices::open(store.handle());
        assert!(restored.list().is_empty());
        assert!(restored.authorize(&paired.cookie, 2_000).is_err());
    }

    #[test]
    fn pairing_does_not_succeed_when_the_index_cannot_be_written() {
        let store = memory_store();
        let devices = Devices::open(Box::new(FailingStore {
            backing: store.handle(),
            fail_write: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
            fail_delete: false,
            index_only: true,
        }));
        assert!(devices.pair("Phone", 1_000).is_err());
        assert!(devices.list().is_empty());
        assert!(store.entries().is_empty(), "the unindexed record must be cleaned up");
        assert!(Devices::open(store.handle()).list().is_empty());
    }

    /// An empty store, for the tests that need only one Devices. The double
    /// itself lives beside the trait, since the gate's suites need it too.
    fn memory_store() -> crate::remote::secret_store::MemorySecretStore {
        crate::remote::secret_store::MemorySecretStore::new()
    }

    const MINUTE_MS: u64 = 60 * 1000;

    /// The id of the one device a test has paired. The list is where ids
    /// come from now that a pairing answer carries only the cookie.
    fn the_only_device(devices: &Devices) -> String {
        let listed = devices.list();
        assert_eq!(listed.len(), 1, "the test paired exactly one device");
        listed[0].id.clone()
    }

    #[test]
    fn a_paired_device_round_trips_through_its_cookie() {
        let store = memory_store();
        let devices = Devices::open(store.handle());
        let paired = devices.pair("Pixel", 1_000).unwrap();

        // The cookie names the device that is now on the list, and carries a
        // secret nothing stored.
        let id = paired.cookie.split_once('.').unwrap().0.to_owned();
        assert_eq!(the_only_device(&devices), id);
        devices
            .authorize(&paired.cookie, 2_000)
            .expect("the device it just paired must admit");
    }

    #[test]
    fn a_cookie_that_is_not_ours_is_refused() {
        let store = memory_store();
        let devices = Devices::open(store.handle());
        devices.pair("Phone", 1_000).unwrap();
        let id = the_only_device(&devices);

        // Malformed, unknown, and wrong-secret shapes are all refused. The
        // sentences differ (they are for the log); the refusals do not.
        assert!(devices.authorize("no-dot", 1_000).is_err());
        assert!(devices.authorize("pd_missing.secret", 1_000).is_err());
        assert!(devices
            .authorize(&format!("{id}.wrong-secret"), 1_000)
            .is_err());
    }

    #[test]
    fn revoking_takes_effect_immediately_and_signals_live_requests() {
        let store = memory_store();
        let devices = Devices::open(store.handle());
        let paired = devices.pair("Phone", 1_000).unwrap();
        let id = the_only_device(&devices);

        let revoked = devices.authorize(&paired.cookie, 1_100).unwrap();
        devices.revoke(&id).unwrap();

        // The live request is told, not just the next one.
        assert!(*revoked.borrow());

        assert!(devices.authorize(&paired.cookie, 1_200).is_err());
        assert!(devices.list().is_empty());
    }

    #[test]
    fn revoke_all_removes_every_device_and_signals_each() {
        let store = memory_store();
        let devices = Devices::open(store.handle());
        let a = devices.pair("A", 1_000).unwrap();
        let b = devices.pair("B", 2_000).unwrap();
        let signal_a = devices.authorize(&a.cookie, 1_100).unwrap();
        let signal_b = devices.authorize(&b.cookie, 2_100).unwrap();

        assert_eq!(devices.revoke_all().unwrap(), 2);
        assert!(*signal_a.borrow());
        assert!(*signal_b.borrow());
        assert!(devices.list().is_empty());
        assert!(devices.authorize(&a.cookie, 3_000).is_err());
        assert!(devices.authorize(&b.cookie, 3_000).is_err());
    }

    #[test]
    fn devices_survive_a_relaunch_of_the_process() {
        let store = memory_store();
        let cookie;
        {
            let first = Devices::open(store.handle());
            cookie = first.pair("Living-room tablet", 1_000).unwrap().cookie;
            let id = the_only_device(&first);
            first
                .rename(&id, "Kitchen tablet")
                .expect("renaming a device it just paired");
            drop(first);
        }

        let second = Devices::open(store.handle());
        let devices = second.list();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].name, "Kitchen tablet");
        assert_eq!(devices[0].paired_at_ms, 1_000);
        let signal = second.authorize(&cookie, 2_000).expect("restored cookie must still admit");
        second.revoke(&devices[0].id).unwrap();
        assert!(*signal.borrow());
        assert!(second.authorize(&cookie, 3_000).is_err());
        let third = Devices::open(store.handle());
        assert!(third.authorize(&cookie, 4_000).is_err());
    }

    #[test]
    fn a_record_the_index_names_but_cannot_be_read_is_dropped_not_fatal() {
        let store = memory_store();
        // An index promising two devices, with only one record behind it.
        store
            .entries()
            .insert("remote-device:index".to_owned(), "[\"pd_a\",\"pd_b\"]".to_owned());
        // A digest is 64 hex characters and the field names are the record's own,
        // so `pd_a` loads and only `pd_b` — whose record is missing entirely —
        // is dropped.
        store.entries().insert(
            "remote-device:pd_a".to_owned(),
            format!(
                "{{\"name\":\"A\",\"secret_hash\":\"{}\",\"paired_at_ms\":1,\"last_seen_ms\":1}}",
                "0".repeat(64)
            ),
        );

        let devices = Devices::open(store.handle());
        let devices = devices.list();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].name, "A");
    }

    #[test]
    fn last_seen_is_persisted_at_most_once_a_minute() {
        let store = memory_store();
        let devices = Devices::open(store.handle());
        let paired = devices.pair("Phone", 0).unwrap();

        // Every write bumps the shared counter: pairing wrote the record
        // once and the index once.
        assert_eq!(store.writes(), 2);

        devices.authorize(&paired.cookie, 10_000).unwrap();
        devices.authorize(&paired.cookie, 30_000).unwrap();
        // Two more validations inside the minute: no further writes.
        assert_eq!(store.writes(), 2);

        // Past the throttle window, the next validation persists once.
        devices.authorize(&paired.cookie, MINUTE_MS + 1_000).unwrap();
        assert_eq!(store.writes(), 3);
        devices.authorize(&paired.cookie, MINUTE_MS + 61_000).unwrap();
        assert_eq!(store.writes(), 3);
    }

    #[test]
    fn the_credential_that_mattered_is_never_stored() {
        // The stored record must not contain the cookie secret, or a copy of
        // the credential store would admit the device it belongs to.
        let store = memory_store();
        let devices = Devices::open(store.handle());
        let paired = devices.pair("Phone", 1_000).unwrap();

        let secret = paired
            .cookie
            .split_once('.')
            .expect("the cookie is id.secret")
            .1;
        for (account, value) in store.entries().iter() {
            assert!(
                !account.starts_with("remote-device:") || !secret.is_empty(),
                "sanity"
            );
            assert!(
                !value.contains(secret),
                "the record {account} stored the secret it was meant to hash"
            );
        }
    }

    #[test]
    fn digests_are_compared_in_constant_time_shape() {
        let a = [7_u8; 32];
        let mut b = a;
        assert!(digests_equal(&a, &b));
        b[31] ^= 1;
        assert!(!digests_equal(&a, &b));
        // A difference in the first byte is found as surely as one in the
        // last: the fold has no early exit.
        b = a;
        b[0] ^= 1;
        assert!(!digests_equal(&a, &b));
    }

    #[test]
    fn a_device_name_is_display_text() {
        // Trimmed, control characters dropped, and bounded.
        assert_eq!(clean_name("  Kitchen tablet  "), "Kitchen tablet");
        assert_eq!(clean_name("tab\tline"), "tabline");
        let long = "x".repeat(200);
        assert_eq!(clean_name(&long).chars().count(), 60);
    }

    #[test]
    fn the_cookie_is_set_http_only_same_site_strict() {
        let header = set_cookie_value("pd_x.secret");
        assert!(header.starts_with("studio_device=pd_x.secret"));
        assert!(header.contains("HttpOnly"));
        assert!(header.contains("SameSite=Strict"));
        assert!(header.contains("Path=/"));
        assert!(header.contains("Max-Age="));
        // `Secure` is deliberately absent: the listener speaks plain HTTP.
        assert!(!header.contains("Secure"));
    }
}
