# ADR 0040 — One bootstrap protocol, two transports

**Status:** Accepted · 2026-08-15
**Relates to:** [ADR 0039](0039-a-child-inherits-nothing-it-was-not-given.md) —
the same boundary, the other direction. 0039 says what the Harness may
*inherit*; this says how it is *handed* the one thing it must never inherit.

## Context

The desktop Host gives the Harness its per-launch admission credential over a
pipe, so that it never appears in an environment or on a command line (008.5).
An environment variable is readable by every descendant and by anything that can
enumerate processes; argv is worse.

On Unix that pipe is file descriptor 4, put in place by `command-fds`, which
`dup2`s into the requested slot from a `pre_exec` hook. Both of those are POSIX.
`command-fds` was declared as an unconditional dependency of `src-tauri`, and
`cargo check` had only ever been run on Linux.

**So the desktop Host had never compiled on Windows.** Not "was untested on
Windows" — the build fails inside `command-fds`'s own source, before this crate
is reached:

```
command-fds-0.2.3/src/lib.rs:54: error[E0432]: unresolved import `nix::fcntl`
command-fds-0.2.3/src/lib.rs:105: error[E0599]: no method named `pre_exec` found
```

Windows is half of 1.0's stated platform scope. Task 008.1 recorded that a
*runtime descendant test* needed a Windows runner; nobody recorded the larger
fact, because nothing on a Windows machine had ever tried. That is meta-task
**#87**.

Fixing the dependency declaration is one line and is not the decision. The
decision is what Windows uses instead, because **the fd mapping is the bootstrap
channel** — remove it and there is no way to deliver the credential at all.

## Decision

**The protocol is fixed; the transport is chosen per platform, in one module.**

| | Unix | Windows |
|---|---|---|
| Bootstrap in | fd 4, mapped by `command-fds` | fd 0 — the child's stdin |
| Readiness out | fd 3, mapped by `command-fds` | fd 1 — the child's stdout |
| Readiness stream is dedicated | yes | no |

`STUDIO/src-tauri/src/harness/channel.rs` owns both. A caller attaches a channel
to a `Command` and delivers the bootstrap to the spawned child; it does not know
which transport it got.

### Why stdin/stdout rather than porting the descriptor mapping

Windows has no way to place an arbitrary handle at a chosen descriptor number.
libuv achieves it for Node children by smuggling handles through the reserved
`STARTUPINFO` field that the MSVC runtime unpacks — which is why the TypeScript
launcher's `stdio` array works on Windows and `std::process::Command` cannot.
Reaching fd 3 and 4 from Rust would mean reimplementing a private CRT
convention.

Descriptors 0 and 1 need none of that: every process has them. The Node
entrypoint already reads the bootstrap with `readFileSync(fd)` and writes
readiness with `writeSync(fd)`, and neither call cares which number it was
handed. **The Windows transport changes the numbers, not the protocol.**

The security property is unchanged. The credential travels *in*, over a pipe
only the parent holds, and never appears in the environment or in argv.

## Consequences

- **Readiness shares stdout on Windows, so the reader cannot take the first
  line.** Measured, not predicted: three lines arrive before the frame, ending
  with `[flue] Server listening on http://127.0.0.1:…`. The reader carries an
  `exclusive` flag rather than relaxing both platforms — on a dedicated
  descriptor, a line that is not the frame is still a fault.
- **A pipe nobody drains blocks the writer.** Once startup succeeds nothing was
  reading the child's streams, which was already latent for `stderr` on both
  platforms and becomes acute when `stdout` carries all logging. The readiness
  reader keeps reading after the frame, and `drain_output` covers the rest.
- **The Node side must not close descriptors 0–2.** `closeSync(readinessFd)` is
  correct for fd 3 and wrong for fd 1. On Node 22.18 for Windows closing fd 1
  was measured *harmless*, so the guard is defensive rather than a fix for an
  observed break — it stays because on POSIX a closed descriptor 1 is the lowest
  free number, so the next file opened becomes stdout and every later write is
  silently appended to it.
- **The two sides cannot import each other**, so
  `tests/integration/harness-bootstrap-channel.test.ts` runs the real entrypoint
  over the Windows transport and binds the variable names to `channel.rs` — the
  same structural guard as ADR 0039's allowlist parity.
- **Windows still has no process-group equivalent.** `cmd.process_group(0)` is
  `#[cfg(unix)]`; the counterpart is a Job Object and this does not create one,
  so a Windows MCP child can outlive its Harness. Meta-task **#89**, recorded
  rather than folded in — it is a lifetime question, not a bootstrap one.
- **The Host's dead code became visible for the first time.** Compiling on
  Windows surfaced a `token` field nothing read, a `stop()` with no caller, and
  an unused re-export. Removed. A crate that never compiles gets no lints.
