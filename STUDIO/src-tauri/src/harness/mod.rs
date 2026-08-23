pub mod bootstrap;
pub mod channel;
pub mod endpoint;
pub mod environment;
pub mod supervisor;

#[cfg(test)]
mod integration;

/// Serialises the tests that each start a real Harness.
///
/// Not an optimisation. Two Harnesses started concurrently do not fail
/// loudly -- they hang: measured with three live tests at once, every one
/// timed out after 30s having printed nothing at all, while each passes alone
/// in about two seconds. Whatever the shared thing is (the Harness opens a
/// database on startup, and a second process waiting on it logs nothing
/// while it waits), the honest fix is to not race them.
#[cfg(test)]
pub(crate) mod test_support {
    pub static ONE_HARNESS_AT_A_TIME: std::sync::Mutex<()> = std::sync::Mutex::new(());
}

// `HarnessReadiness` was re-exported here and imported by nobody — the
// supervisor names it through `endpoint::` directly. Another one the first
// Windows compile surfaced (#87).
// `HarnessEndpoint` itself is no longer re-exported: it carries the bearer,
// and since the service seam landed nothing outside this module has a use for
// it. `lib.rs` names the view; `services.rs` reaches the supervisor's own
// methods and never needs the type by name.
pub use endpoint::HarnessEndpointView;
pub use supervisor::{HarnessStatus, HarnessSupervisor};
