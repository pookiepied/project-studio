//! In-session cancellation for `service_stream`.
//!
//! The stream's own module (`stream.rs`) documents why a Tauri channel cannot
//! carry a signal from the webview back to Rust: the only built-in discovery
//! of a gone reader is a send failing, and that happens once the webview is
//! destroyed. Within one live session -- the user switches conversations,
//! closes a pane, navigates away -- nothing bounded how long the old read kept
//! its HTTP connection open. This module is the prompt path: the webview names
//! its stream with an id when it starts one, and asks Rust to cancel that id
//! when it is done with it.
//!
//! Three properties it exists to hold:
//!
//! - **Prompt, not eventually.** The registry hands the stream a `watch`
//!   receiver that sits in the consume loop's `select!`, so a cancel wakes the
//!   loop immediately -- not at the next heartbeat, and not after
//!   [`READ_IDLE_TIMEOUT`](super::stream::READ_IDLE_TIMEOUT).
//! - **Idempotent, not fussy.** Cancelling an unknown id (never registered),
//!   a finished stream (already released), or the same stream twice removes
//!   nothing the second time and is never an error. The webview should not
//!   have to track which cancels "count".
//! - **No graves.** An entry lives exactly as long as its registration: the
//!   registration's `Drop` unregisters it if the stream ended on its own
//!   first, so every exit path -- including the ones that leave through an
//!   error -- cleans up. And registering over a live id signals the previous
//!   reader outright, so two streams cannot accumulate behind one id.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::watch;

/// One live registration: the half of a `watch` pair whose transition from
/// `false` to `true` means "stop reading".
struct Entry {
    cancel: watch::Sender<bool>,
}

/// Maps caller-chosen stream ids to their cancellation senders.
///
/// A `HashMap` behind a mutex, and deliberately nothing more: no epochs, no
/// weak references, no slab. The webview generates ids the same way it
/// generates every other local record id, registrations are per-invocation,
/// and the staleness cases are answered by pointer equality and an explicit
/// signal rather than by more machinery.
#[derive(Default)]
pub(crate) struct StreamRegistry {
    entries: Mutex<HashMap<String, Arc<Entry>>>,
}

impl StreamRegistry {
    /// Registers `stream_id` and returns both the guard that keeps the entry
    /// alive and the receiver the stream watches.
    ///
    /// Registering an id that is already live cancels the previous reader
    /// first: whatever that older stream still believed it was watching, the
    /// webview has said this id now belongs to a newer read of the same
    /// conversation.
    pub(crate) fn register(
        self: &Arc<Self>,
        stream_id: &str,
    ) -> (StreamRegistration, watch::Receiver<bool>) {
        let (sender, receiver) = watch::channel(false);
        let entry = Arc::new(Entry { cancel: sender });
        if let Some(previous) = self.lock().insert(stream_id.to_owned(), Arc::clone(&entry)) {
            let _ = previous.cancel.send(true);
        }
        (
            StreamRegistration {
                registry: Arc::clone(self),
                stream_id: stream_id.to_owned(),
                entry,
            },
            receiver,
        )
    }

    /// Cancels the stream registered under `stream_id`, returning whether
    /// there was one. Removing the entry before signalling is what makes a
    /// second call a no-op rather than a second signal.
    pub(crate) fn cancel(&self, stream_id: &str) -> bool {
        match self.lock().remove(stream_id) {
            Some(entry) => {
                let _ = entry.cancel.send(true);
                true
            }
            None => false,
        }
    }

    /// Removes `entry` from `stream_id` only if the registry still holds that
    /// exact registration. A guard released after a recycle or a cancel must
    /// not reach forward in time and unregister somebody else.
    fn release(&self, stream_id: &str, entry: &Arc<Entry>) {
        let mut entries = self.lock();
        if entries
            .get(stream_id)
            .is_some_and(|current| Arc::ptr_eq(current, entry))
        {
            entries.remove(stream_id);
        }
    }

    /// Locks, without ceremony. A poisoned lock means a panic already unwound
    /// through this type; every caller downstream is about to see far stranger
    /// things than a repeated error.
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Entry>>> {
        self.entries.lock().expect("stream registry lock")
    }
}

/// Keeps one stream's registry entry alive until dropped or cancelled.
///
/// Held by `service_stream` across the whole request. Dropping it releases the
/// entry -- that is the path by which streams that end on their own leave
/// nothing behind, including exits through a broken transport or a refused
/// request, where an explicit cleanup call would be easy to forget.
pub(crate) struct StreamRegistration {
    registry: Arc<StreamRegistry>,
    stream_id: String,
    entry: Arc<Entry>,
}

impl Drop for StreamRegistration {
    fn drop(&mut self) {
        self.registry.release(&self.stream_id, &self.entry);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// How long a test waits for a cancellation to be observable before
    /// concluding it never happened.
    const PROMPT: Duration = Duration::from_secs(2);

    #[tokio::test]
    async fn cancelling_a_registered_stream_signals_it_once() {
        let registry = Arc::new(StreamRegistry::default());
        let (_registration, mut receiver) = registry.register("s1");

        assert!(registry.cancel("s1"));
        tokio::time::timeout(PROMPT, receiver.changed())
            .await
            .expect("the cancel arrived promptly")
            .expect("the sender outlived the signal");
        assert!(*receiver.borrow());

        // The entry went with the signal: the second cancel finds nothing,
        // which is what makes cancelling twice harmless.
        assert!(!registry.cancel("s1"));
    }

    #[test]
    fn cancelling_an_unknown_stream_reports_quietly() {
        let registry = StreamRegistry::default();
        assert!(!registry.cancel("never-registered"));
    }

    #[test]
    fn a_released_registration_leaves_no_entry_behind() {
        let registry = Arc::new(StreamRegistry::default());
        drop(registry.register("s2"));
        assert!(!registry.cancel("s2"), "the natural end already cleaned up");
    }

    #[test]
    fn a_recycled_id_is_not_cancelled_by_the_first_registrations_guard() {
        let registry = Arc::new(StreamRegistry::default());
        let (first, _first_rx) = registry.register("s3");
        // The first stream ended on its own; its guard was held longer than
        // the stream stayed interesting, and meanwhile the webview reused the
        // id. Releasing afterwards must not unregister the new tenant.
        let (second, _second_rx) = registry.register("s3");
        drop(first);

        assert!(registry.cancel("s3"), "the live registration survives");
        drop(second);
        assert!(!registry.cancel("s3"));
    }

    #[tokio::test]
    async fn registering_over_a_live_id_cancels_the_previous_reader() {
        let registry = Arc::new(StreamRegistry::default());
        let (_stale_guard, mut stale) = registry.register("s4");
        let (_fresh_guard, _fresh_rx) = registry.register("s4");

        tokio::time::timeout(PROMPT, stale.changed())
            .await
            .expect("the stale reader was told promptly")
            .expect("the signal was a change, not a close");
        assert!(*stale.borrow(), "the stale read was cancelled");

        assert!(registry.cancel("s4"), "only the fresh registration remains");
        assert!(!registry.cancel("s4"));
    }
}
