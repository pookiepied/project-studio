//! The pairing code: the one thing a new device needs to become paired.
//!
//! A six-character code, valid for a few minutes and usable once (ADR 0050
//! §3.4). It lives only in memory — it is meant to be read off the desktop
//! screen and typed on a phone, and a code that outlives the process that
//! showed it is a longer-lived credential pretending to be a short-lived
//! one. The durable credentials are the device cookies `devices.rs` mints;
//! the code is the front door, not the key.
//!
//! Six characters is short enough to be worth guessing, which is why the
//! endpoint that accepts one is rate limited: a few attempts per minute,
//! then a cooldown. Together that makes an exhaustive search a matter of
//! centuries rather than minutes: 31^6 ≈ 8.9×10^8 codes, at five attempts a
//! minute.
//!
//! The alphabet excludes the letters and digits that are hard to tell apart
//! on a phone screen — I, L, O, 0 and 1 — because the person typing this
//! code is reading it off another display, and a code that is technically
//! unambiguous but practically ambiguous is a support ticket.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use super::devices::digests_equal;

/// How long a minted code may wait to be used.
const CODE_TTL: Duration = Duration::from_secs(5 * 60);

/// How many pairing attempts one address may make per window.
const MAX_ATTEMPTS: usize = 5;

/// The window those attempts are counted in.
const ATTEMPT_WINDOW: Duration = Duration::from_secs(60);

const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/// The pairing code as the app holds it.
#[derive(Default)]
pub(crate) struct PairingState {
    inner: std::sync::Mutex<Option<Active>>,
    limiter: AttemptLimiter,
}

struct Active {
    code: String,
    expires: Instant,
}

impl PairingState {
    /// Mints a fresh code, replacing any previous one.
    ///
    /// Replacing rather than refusing: the desktop screen should always show
    /// a code that works, and a person who asks again has waited long enough
    /// or lost the paper they read it onto. The old code was single-use and
    /// short-lived anyway.
    pub(crate) fn mint(&self, now: std::time::Instant) -> String {
        let code = generate_code();
        let mut inner = self.lock();
        *inner = Some(Active {
            code: code.clone(),
            expires: now + CODE_TTL,
        });
        code
    }

    /// The code currently shown, if it is still valid.
    pub(crate) fn active(&self, now: std::time::Instant) -> Option<String> {
        let mut inner = self.lock();
        let active = inner.as_mut()?;
        if now > active.expires {
            // Expired: clear it, so the next `mint` is the honest answer
            // rather than a code that looks alive and is not.
            *inner = None;
            return None;
        }
        Some(active.code.clone())
    }

    /// Consumes a candidate code if it matches the active one, is unexpired,
    /// and has not been used. Answers once; a consumed code cannot be reused.
    pub(crate) fn consume(&self, candidate: &str, now: std::time::Instant) -> bool {
        let normalized = normalize(candidate);
        let mut inner = self.lock();
        let Some(active) = inner.as_mut() else {
            return false;
        };
        if now > active.expires {
            *inner = None;
            return false;
        }
        // Both values are hashed before comparison, so the timing of the
        // comparison carries nothing about where they first differ — the same
        // shape the admission verifier uses for its bearer.
        let presented: [u8; 32] = Sha256::digest(normalized.as_bytes()).into();
        let expected: [u8; 32] = Sha256::digest(active.code.as_bytes()).into();
        if !digests_equal(&presented, &expected) {
            return false;
        }
        *inner = None;
        true
    }

    /// Whether one pairing attempt from one address may proceed, recording it
    /// if so. See [`AttemptLimiter::admit`].
    pub(crate) fn admit_attempt(&self, address: IpAddr, now: std::time::Instant) -> bool {
        self.limiter.admit(address, now)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Active>> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Whether one pairing attempt from one address may proceed, recording it if
/// so. Both allowed and refused attempts count: the limiter exists because
/// the code is short, and an attacker who is refused must not be able to buy
/// more tries by being refused.
pub(crate) struct AttemptLimiter {
    attempts: Mutex<HashMap<IpAddr, Vec<std::time::Instant>>>,
}

impl Default for AttemptLimiter {
    fn default() -> Self {
        AttemptLimiter {
            attempts: Mutex::new(HashMap::new()),
        }
    }
}

impl AttemptLimiter {
    pub(crate) fn admit(&self, address: IpAddr, now: std::time::Instant) -> bool {
        let mut attempts = self
            .attempts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let recent = attempts.entry(address).or_default();
        recent.retain(|moment| now.duration_since(*moment) < ATTEMPT_WINDOW);
        if recent.len() >= MAX_ATTEMPTS {
            // The refusal is itself an attempt: the window is held open by
            // activity, and the cooldown ends when the attempts age out.
            recent.push(now);
            return false;
        }
        recent.push(now);
        true
    }
}

fn normalize(input: &str) -> String {
    input
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

fn generate_code() -> String {
    use rand::RngCore;
    let mut rng = rand::thread_rng();
    let mut code = String::with_capacity(6);
    while code.len() < 6 {
        let mut byte = [0_u8; 1];
        rng.fill_bytes(&mut byte);
        // Rejection sampling: 31 does not divide 256, so bytes at or above
        // 31×8 are dropped rather than folded in, which would weight the
        // first eight letters heavier than the rest.
        if byte[0] < (31 * 8) as u8 {
            code.push(CODE_ALPHABET[(byte[0] % 31) as usize] as char);
        }
    }
    code
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minute(seconds: u64) -> std::time::Instant {
        std::time::Instant::now() + Duration::from_secs(seconds)
    }

    #[test]
    fn a_code_is_six_unambiguous_characters() {
        for _ in 0..200 {
            let code = generate_code();
            assert_eq!(code.len(), 6);
            for character in code.chars() {
                assert!(
                    "ABCDEFGHJKMNPQRSTUVWXYZ23456789".contains(character),
                    "{character} is not from the alphabet"
                );
            }
        }
    }

    #[test]
    fn a_code_works_once_within_five_minutes() {
        let state = PairingState::default();
        let code = state.mint(std::time::Instant::now());

        assert!(state.consume(&code.to_lowercase(), std::time::Instant::now()));
        // Used up: the same code, again, is refused.
        assert!(!state.consume(&code, std::time::Instant::now()));
    }

    #[test]
    fn an_expired_code_is_refused_and_cleared() {
        let state = PairingState::default();
        state.mint(std::time::Instant::now());
        // Minted now, consumed "six minutes" from now.
        assert!(!state.consume("ABCDEF", minute(6 * 60 + 1)));
        assert!(state.active(minute(6 * 60 + 2)).is_none());
    }

    #[test]
    fn the_code_is_compared_after_normalisation() {
        let state = PairingState::default();
        let code = state.mint(std::time::Instant::now());

        // The phone's keyboard may capitalise, and the person may type
        // spaces; neither is a refusal.
        let spaced = format!("{} {}", &code[..3], &code[3..]);
        assert!(state.consume(&spaced.to_ascii_lowercase(), std::time::Instant::now()));
    }

    #[test]
    fn a_wrong_code_is_refused() {
        let state = PairingState::default();
        let code = state.mint(std::time::Instant::now());
        // Every character becomes its alphabet neighbour, so the candidate
        // differs from the real code wherever the code happened to land —
        // replacing one particular letter would miss codes without it.
        let alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        let other: String = code
            .chars()
            .map(|c| {
                let index = alphabet.find(c).unwrap();
                alphabet.chars().nth((index + 1) % alphabet.len()).unwrap()
            })
            .collect();
        assert!(!state.consume(&other, std::time::Instant::now()));
        // The real code still works: a failed guess does not consume it.
        assert!(state.consume(&code, std::time::Instant::now()));
    }

    #[test]
    fn minting_replaces_the_previous_code() {
        let state = PairingState::default();
        let first = state.mint(std::time::Instant::now());
        let second = state.mint(std::time::Instant::now());
        assert_ne!(first, second);
        assert!(!state.consume(&first, std::time::Instant::now()));
        assert!(state.consume(&second, std::time::Instant::now()));
    }

    #[test]
    fn five_attempts_are_admitted_and_the_sixth_is_not() {
        let limiter = AttemptLimiter::default();
        let address: IpAddr = "192.168.1.50".parse().unwrap();
        let start = std::time::Instant::now();

        for attempt in 0..5 {
            let now = start + Duration::from_secs(attempt);
            assert!(limiter.admit(address, now), "attempt {attempt} should pass");
        }
        assert!(!limiter.admit(address, start + Duration::from_secs(5)));

        // A refusal is itself an attempt: the window is held open by
        // activity, so hammering does not earn a reset.
        assert!(!limiter.admit(address, start + Duration::from_secs(30)));
        assert!(!limiter.admit(address, start + Duration::from_secs(59)));
        // Not even sixty seconds after the first attempt, because the
        // refusals themselves held the window open.
        assert!(!limiter.admit(address, start + Duration::from_secs(61)));

        // After every attempt has aged out — a full window past the last
        // one — the address may try again.
        assert!(limiter.admit(address, start + Duration::from_secs(120)));
    }
}