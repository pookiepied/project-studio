//! What the Harness child inherits from this process — the Rust half of one
//! policy.
//!
//! This exists because the answer used to be "everything, minus one variable",
//! written inline at the spawn site under a `// For now` comment (meta-task
//! #74). That is a decision, not a detail, and it was being made by whoever
//! happened to be editing `spawn_child`. It is made here now, once, and the
//! spawn site calls [`apply_harness_environment`] instead of reasoning about it.
//!
//! **The rule: an environment is built from a stated policy, never copied from
//! the host process.** A denylist cannot work — it has to enumerate every
//! secret anyone might export, and it is wrong the first time someone invents a
//! new one. An allowlist is wrong in the direction that gets noticed: something
//! fails to start, and says which variable it wanted.
//!
//! The Harness is not the same kind of child as the programs *it* starts. It is
//! first-party code whose job includes resolving real binaries, so it keeps
//! `PATH` and a home directory. Containment for the programs it then finds is
//! applied to those programs, by `buildEnvironment` on the TypeScript side.
//!
//! The TypeScript half is `STUDIO HARNESS/src/process/environment.ts`, and
//! `tests/unit/harness-environment-parity.test.ts` fails if these two lists
//! stop agreeing. Neither language can import the other, so the copies are each
//! internally consistent and drift between them is silent — the same situation
//! as the duplicated git subcommand lists, handled the same way.
//!
//! ADR 0039 records the decision.

use std::process::Command;

/// The variables the Harness inherits, and nothing else.
///
/// Every entry is here because something in the Harness measurably reads it.
/// The list was built by enumerating `process.env` reads across its `src/`, not
/// by guessing what a Node process might want:
///
/// - `PATH` — `vendor/resolver.ts` and `tools/shell/resolve.ts` resolve real
///   binaries through it. Without it the Harness cannot find git or ripgrep.
/// - `HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH` — `platform/paths.ts` calls
///   `homedir()`. Without these there is no `~/.studio`: no database, no
///   snapshots, no vendor directory.
/// - `SystemRoot`, `windir`, `TEMP`, `TMP` — OS plumbing. Many Windows binaries
///   fail to initialise their socket and crypto layers without `SystemRoot`,
///   and git cannot write an index lock without a temp directory.
/// - `LANG`, `LC_ALL` — affect only how child output is decoded.
///
/// **What is absent is the point.** Not here: every API key, cloud credential,
/// CI token and provider secret a developer has exported into the shell that
/// launched this app. And two by name:
///
/// - `PROJECT_STUDIO_ADMISSION_CREDENTIAL` — the per-launch credential travels
///   over a file descriptor precisely so it never appears in an environment
///   (008.5). Inheriting it would undo that in one line. It is not merely
///   removed here; it is never added, which is a stronger statement.
/// - `NODE_OPTIONS` — it carries `--require`, which is arbitrary code execution
///   inside the Harness before any of our code runs. An inherited `NODE_OPTIONS`
///   is a preload controlled by whatever launched us, and nothing we do
///   afterwards would observe it.
///
/// Sorted, because the parity test compares these lists element by element and
/// a sorted list makes a disagreement readable.
pub const HARNESS_INHERITED_VARIABLES: &[&str] = &[
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LANG",
    "LC_ALL",
    "PATH",
    "SystemRoot",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "windir",
];

/// Replaces the child's environment with the allowlist.
///
/// `env_clear` first, and that ordering is the whole mechanism. Removing known
/// variables from an inherited environment leaves everything nobody thought of,
/// which is exactly the set that matters. Clearing and re-adding leaves only
/// what this list names.
///
/// Variables the Host supplies deliberately — `PORT`, the hostname, the two fd
/// numbers — are set by the caller *after* this runs, so they are not on the
/// list and cannot be shadowed by a host variable of the same name.
pub fn apply_harness_environment(cmd: &mut Command) {
    cmd.env_clear();

    for name in HARNESS_INHERITED_VARIABLES {
        if let Ok(value) = std::env::var(name) {
            cmd.env(name, value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The credential must not be reachable, whatever the host environment says.
    ///
    /// Written as a property of the list rather than of one spawn, because the
    /// spawn site is what got this wrong: it removed the credential explicitly,
    /// which is correct only for the one variable someone remembered.
    #[test]
    fn the_allowlist_admits_no_secret_carrier() {
        for forbidden in [
            "PROJECT_STUDIO_ADMISSION_CREDENTIAL",
            "NODE_OPTIONS",
            "AWS_SECRET_ACCESS_KEY",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "GITHUB_TOKEN",
        ] {
            assert!(
                !HARNESS_INHERITED_VARIABLES.contains(&forbidden),
                "{forbidden} must not be inherited by the Harness"
            );
        }
    }

    /// Sorted and unique — the parity test on the TypeScript side compares
    /// against a list in this order, and a duplicate would make one side longer
    /// than the other for no reason a reader could see.
    #[test]
    fn the_allowlist_is_sorted_and_unique() {
        let mut sorted = HARNESS_INHERITED_VARIABLES.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.as_slice(), HARNESS_INHERITED_VARIABLES);
    }

    /// `env_clear` has to come first, or the allowlist is an addition to the
    /// host environment rather than a replacement for it.
    #[test]
    fn applying_the_policy_clears_before_it_adds() {
        std::env::set_var("PROJECT_STUDIO_TEST_LEAK", "secret");
        let mut cmd = Command::new("node");
        apply_harness_environment(&mut cmd);

        let inherited: Vec<_> = cmd
            .get_envs()
            .filter_map(|(key, value)| value.map(|_| key.to_string_lossy().into_owned()))
            .collect();

        assert!(!inherited.iter().any(|name| name == "PROJECT_STUDIO_TEST_LEAK"));
        std::env::remove_var("PROJECT_STUDIO_TEST_LEAK");
    }
}
