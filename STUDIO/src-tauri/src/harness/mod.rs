pub mod bootstrap;
pub mod channel;
pub mod endpoint;
pub mod environment;
pub mod supervisor;

// `HarnessEndpoint` itself is no longer re-exported: it carries the bearer,
// and since the service seam landed nothing outside this module has a use for
// it. `lib.rs` names the view; `services.rs` reaches the supervisor's own
// methods and never needs the type by name.
pub use endpoint::HarnessEndpointView;
pub use supervisor::{HarnessStatus, HarnessSupervisor};

/// Serialises the tests that each start a real Harness.
///
/// Not an optimisation. Two Harnesses started concurrently do not fail
/// loudly — they hang: measured with three live tests at once, every one
/// timed out after 30s having printed nothing at all, while each passes alone
/// in about two seconds. Whatever the shared thing is (the Harness opens a
/// database on startup, and a second process waiting on it logs nothing
/// while it waits), the honest fix is to not race them.
///
/// Tokio's rather than std's because the service-seam tests are async and
/// hold the guard across `.await`; a std guard there is a clippy lint and,
/// on a multi-thread runtime, a deadlock waiting for its moment. The one
/// sync taker (`integration.rs`) uses `blocking_lock`, which is correct
/// exactly because that test runs on no runtime at all.
#[cfg(test)]
pub(crate) mod test_support {
    pub static ONE_HARNESS_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    /// Shuts a supervisor down even when an assertion between start and stop
    /// panics.
    ///
    /// Without this a failing live test leaks a Node process holding a
    /// loopback port and the data home for the rest of the machine's uptime,
    /// and the next run inherits the mess.
    pub struct StopOnDrop(pub super::supervisor::HarnessSupervisor);

    impl Drop for StopOnDrop {
        fn drop(&mut self) {
            self.0.shutdown_all();
        }
    }
}

#[cfg(test)]
mod integration;
