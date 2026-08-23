//! How the Host hands the Harness its credential, and how the Harness answers.
//!
//! One contract, two transports. The contract is fixed and is the security
//! property: **the admission credential is written into the child over a pipe
//! only the parent holds, and never appears in the environment or on the
//! command line.** That is why it is a pipe at all (008.5) — an environment
//! variable is readable by every descendant and by anything that can list
//! processes, and argv is worse.
//!
//! The transport underneath is not the same on both platforms, and pretending
//! otherwise is what meta-task **#87** was:
//!
//! | Platform | Bootstrap in | Readiness out | Dedicated stream |
//! |---|---|---|---|
//! | Unix | fd 4, mapped by `command-fds` | fd 3, mapped by `command-fds` | yes |
//! | Windows | fd 0 — the child's stdin | fd 1 — the child's stdout, one marked line | no |
//!
//! `command-fds` maps arbitrary descriptors with `dup2` in a `pre_exec` hook.
//! Both of those are POSIX; the crate does not compile on Windows, and it was
//! declared as an unconditional dependency, so **the desktop Host had never
//! built on Windows at all** — the failure lands inside `command-fds`'s own
//! source before this crate is reached. Windows is half of 1.0's platform
//! scope, and `cargo check` had only ever been run on Linux, so nothing said so.
//!
//! ## Why stdin/stdout rather than porting the descriptor mapping
//!
//! Windows has no `dup2`-into-a-numbered-slot for an arbitrary handle. libuv
//! achieves it for Node children by smuggling handles through the reserved
//! `STARTUPINFO` field that the MSVC runtime unpacks — which is why the
//! *TypeScript* launcher's `stdio` array works on Windows and this does not.
//! `std::process::Command` exposes no such thing, so reaching fd 3 and 4 from
//! Rust would mean reimplementing that private CRT convention.
//!
//! fds 0 and 1 need none of it: every process gets them. The Node side already
//! reads the bootstrap with `readFileSync(fd)` and writes readiness with
//! `writeSync(fd)`, and neither call cares which number it was given. So the
//! Windows transport changes the *numbers*, not the protocol.
//!
//! ## What sharing stdout costs, and what pays for it
//!
//! On Windows the readiness frame arrives on the same stream as the Harness's
//! ordinary logging, so the reader cannot treat the first line it sees as the
//! answer. {@link ReadinessStream::exclusive} records which situation the reader
//! is in: on Unix fd 3 carries readiness and nothing else, and anything else
//! appearing there is a fault worth failing on; on Windows other lines are
//! expected and are kept as diagnostics instead.
//!
//! The credential still never touches stdout. It travels *in*, over stdin.

use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};

/// Child descriptor the readiness frame is written to.
///
/// Unix only. On Windows the readiness frame goes to fd 1 with the rest of the
/// child's output, and the value is set in [`BootstrapChannel::attach`].
#[cfg(unix)]
pub const READINESS_FD: i32 = 3;

/// Child descriptor the admission bootstrap is read from. Unix only.
#[cfg(unix)]
pub const BOOTSTRAP_FD: i32 = 4;

/// The readiness half, after the bootstrap has been delivered.
pub struct ReadinessStream {
    /// Boxed because the two transports produce different concrete types — an
    /// `os_pipe::PipeReader` on Unix and the child's `ChildStdout` on Windows —
    /// and the reader above has no reason to know which.
    pub reader: Box<dyn Read + Send>,
    /// True when nothing but readiness may appear on this stream.
    pub exclusive: bool,
}

/// The channel, configured on the `Command` but not yet delivered.
///
/// Two-phase on purpose. The descriptors have to be attached before `spawn`,
/// and the credential can only be written after it, so a single call cannot do
/// both without also owning the spawn.
pub struct BootstrapChannel {
    #[cfg(unix)]
    bootstrap_reader: os_pipe::PipeReader,
    #[cfg(unix)]
    bootstrap_writer: os_pipe::PipeWriter,
    #[cfg(unix)]
    readiness_reader: os_pipe::PipeReader,
    #[cfg(unix)]
    readiness_writer: os_pipe::PipeWriter,
}

impl BootstrapChannel {
    /// Attaches the channel to a command that has not been spawned yet.
    ///
    /// Sets the child's stdin and the two `PROJECT_STUDIO_*_FD` variables that
    /// tell the Node entrypoint where to look. `stdout` and `stderr` are the
    /// caller's to configure, except that on Windows `stdout` must be piped —
    /// it is the readiness stream.
    ///
    /// Must be called *after* the environment policy is applied
    /// (`apply_harness_environment`), because that clears the environment and
    /// would wipe these two variables. ADR 0039 states the ordering rule; this
    /// is the case it protects.
    #[cfg(unix)]
    pub fn attach(cmd: &mut Command) -> Result<Self, String> {
        use command_fds::{CommandFdExt, FdMapping};
        use std::os::unix::io::AsRawFd;

        let (bootstrap_reader, bootstrap_writer) =
            os_pipe::pipe().map_err(|e| format!("failed to create bootstrap pipe: {e}"))?;
        let (readiness_reader, readiness_writer) =
            os_pipe::pipe().map_err(|e| format!("failed to create readiness pipe: {e}"))?;

        cmd.env("PROJECT_STUDIO_READINESS_FD", READINESS_FD.to_string());
        cmd.env(
            "PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD",
            BOOTSTRAP_FD.to_string(),
        );
        cmd.stdin(Stdio::null());

        // `command-fds` owns the CLOEXEC handling and the `dup2` into the
        // requested slots.
        cmd.fd_mappings(vec![
            FdMapping {
                parent_fd: bootstrap_reader.as_raw_fd(),
                child_fd: BOOTSTRAP_FD,
            },
            FdMapping {
                parent_fd: readiness_writer.as_raw_fd(),
                child_fd: READINESS_FD,
            },
        ])
        .map_err(|e| format!("failed to map fds: {e}"))?;

        Ok(Self {
            bootstrap_reader,
            bootstrap_writer,
            readiness_reader,
            readiness_writer,
        })
    }

    #[cfg(windows)]
    pub fn attach(cmd: &mut Command) -> Result<Self, String> {
        // 0 and 1, not 4 and 3. The Node entrypoint parses these as integers
        // and passes them straight to `readFileSync`/`writeSync`, so the
        // protocol is unchanged — only which descriptor carries it.
        cmd.env("PROJECT_STUDIO_READINESS_FD", "1");
        cmd.env("PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD", "0");
        cmd.stdin(Stdio::piped());
        Ok(Self {})
    }

    /// Writes the bootstrap into the spawned child and returns the readiness half.
    ///
    /// The writer is dropped immediately afterwards on both platforms. That EOF
    /// is not a courtesy: the child reads the descriptor to end-of-file, so a
    /// writer left open is a Harness that never finishes starting.
    #[cfg(unix)]
    pub fn deliver(mut self, _child: &mut Child, bootstrap_json: &str) -> Result<ReadinessStream, String> {
        // The child holds its own copies now, so the parent's must go or the
        // reader below never sees EOF when the child exits.
        drop(self.bootstrap_reader);
        drop(self.readiness_writer);

        self.bootstrap_writer
            .write_all(bootstrap_json.as_bytes())
            .map_err(|e| format!("failed to write bootstrap: {e}"))?;
        drop(self.bootstrap_writer);

        Ok(ReadinessStream {
            reader: Box::new(self.readiness_reader),
            exclusive: true,
        })
    }

    #[cfg(windows)]
    pub fn deliver(self, child: &mut Child, bootstrap_json: &str) -> Result<ReadinessStream, String> {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "harness stdin was not piped".to_string())?;
        stdin
            .write_all(bootstrap_json.as_bytes())
            .map_err(|e| format!("failed to write bootstrap: {e}"))?;
        drop(stdin);

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "harness stdout was not piped".to_string())?;

        Ok(ReadinessStream {
            reader: Box::new(stdout),
            exclusive: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attach_names_the_descriptors_the_node_entrypoint_looks_for() {
        // The two variable names are a contract with the patched Flue
        // entrypoint (`patches/@flue__cli@1.0.0-beta.9.patch`). Renaming one
        // here alone produces a Harness that starts, never reads a credential,
        // and rejects every request as unadmitted.
        let mut cmd = Command::new("node");
        let channel = BootstrapChannel::attach(&mut cmd).expect("attach");

        let names: Vec<String> = cmd
            .get_envs()
            .filter_map(|(k, v)| v.map(|_| k.to_string_lossy().into_owned()))
            .collect();
        assert!(names.iter().any(|n| n == "PROJECT_STUDIO_READINESS_FD"));
        assert!(names
            .iter()
            .any(|n| n == "PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD"));

        drop(channel);
    }

    #[test]
    fn the_bootstrap_never_becomes_an_environment_variable() {
        // The whole reason the channel exists. If the credential could be
        // passed as an environment variable there would be no pipe here at all.
        let mut cmd = Command::new("node");
        let channel = BootstrapChannel::attach(&mut cmd).expect("attach");

        for (name, value) in cmd.get_envs() {
            let name = name.to_string_lossy().into_owned();
            assert_ne!(name, "PROJECT_STUDIO_ADMISSION_CREDENTIAL");
            if let Some(value) = value {
                assert!(
                    !value.to_string_lossy().contains("credential"),
                    "{name} carries something credential-shaped"
                );
            }
        }

        drop(channel);
    }

    #[test]
    #[cfg(windows)]
    fn windows_points_the_child_at_its_own_standard_descriptors() {
        // Zero and one, because Windows cannot be told to use three and four.
        let mut cmd = Command::new("node");
        let _channel = BootstrapChannel::attach(&mut cmd).expect("attach");

        let mut readiness = None;
        let mut bootstrap = None;
        for (name, value) in cmd.get_envs() {
            match name.to_string_lossy().as_ref() {
                "PROJECT_STUDIO_READINESS_FD" => {
                    readiness = value.map(|v| v.to_string_lossy().into_owned())
                }
                "PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD" => {
                    bootstrap = value.map(|v| v.to_string_lossy().into_owned())
                }
                _ => {}
            }
        }
        assert_eq!(readiness.as_deref(), Some("1"));
        assert_eq!(bootstrap.as_deref(), Some("0"));
    }

    #[test]
    #[cfg(unix)]
    fn unix_keeps_readiness_off_the_shared_output_stream() {
        let mut cmd = Command::new("node");
        let _channel = BootstrapChannel::attach(&mut cmd).expect("attach");

        for (name, value) in cmd.get_envs() {
            if name.to_string_lossy() == "PROJECT_STUDIO_READINESS_FD" {
                let value = value.map(|v| v.to_string_lossy().into_owned());
                assert_eq!(value.as_deref(), Some("3"));
            }
        }
    }
}
