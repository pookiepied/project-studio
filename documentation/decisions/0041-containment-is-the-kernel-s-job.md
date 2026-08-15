# ADR 0041 — Containment is the kernel's job

**Status:** Accepted · 2026-08-15
**Relates to:** [ADR 0039](0039-a-child-inherits-nothing-it-was-not-given.md) —
the same taxonomy of children, the other axis. 0039 says what a child *inherits*;
this says what a child can *reach*.
**Supersedes in part:** the containment claims in [ADR
0019](0019-running-a-chosen-program.md), which were true about
authorization and overstated about isolation.

## Context

`LocalSandbox` provided `in-process` isolation: every path an agent asked for
was resolved through one function, and anything outside the workspace was
refused. That is a real boundary for our own code and no boundary at all for a
subprocess. `contracts/effects.ts` said so plainly — `execute` and `network`
require `os` — and `assertSupports` compared the two, found the shortfall, and
**continued**, under a comment explaining that it was doing nothing. Meta-task
#15.

Stage 4b step 1 replaced the fall-through with a refusal that consults measured
support, which is what finally raised `unsupported_isolation` (#32). It changed
no behaviour on any machine, because no backend existed. This ADR is about
building one.

## Decision

**Containment is applied by the operating system at process creation, not by the
harness at call time.** The harness decides *whether* a child is owed
containment; the kernel decides what the child can touch, and the child cannot
argue with it.

### One taxonomy, not a second one

The kinds are ADR 0039's, unchanged:

| Kind | Who chose the program | Environment (0039) | Isolation |
|---|---|---|---|
| `tool` — `git`, `rg` | us | `buildEnvironment()` | none |
| `shell` | **the model** | `buildEnvironment()` | **`os`** |
| `mcp-server` | **a third party** | `buildEnvironment(declared)` | **`os`** |

The first row is load-bearing rather than lenient. `runProcess` is the single
spawn point for the model's commands *and* for the `git` calls the snapshot
system depends on; containing it wholesale would take undo down with it. So the
tier is a property of the kind, decided in `sandbox/isolation/kinds.ts`, and
`architecture.test.ts` closes the list of modules allowed to call `runProcess`
directly — because a new execute-capable tool reaching for the familiar function
is how this regresses, and that is invisible in review.

### A launcher, not a library

Windows containment needs Win32 calls Node cannot make. The options were a
native addon — which makes every platform's test run depend on a compiled
module — moving execution into the Tauri host, which is a rewrite, or a small
binary that applies a policy and execs. We build the binary:
`native/windows-appcontainer/`, shipped as `vendor/win32-x64/studio-contain.exe`
beside `rg.exe`, resolved the same way.

This is the shape Linux already has. `bwrap` is that binary, supplied by the OS.

### AppContainer, because of the edition

Windows Sandbox and Hyper-V containers are Pro and Enterprise features. The
target machine is Windows 11 **Home**, the most common consumer edition, and a
design that does not run there does not run for most users. AppContainer is a
kernel *token* feature: creating a profile needs no elevation. Measured, not
read.

### Availability is probed; registration is per platform

Two questions that look like one and are not:

- *Does this build have an implementation for this platform?* Fixed when the
  code was written. Answered by a platform key in `isolation/registry.ts`.
- *Does it work on this machine?* Answered by `available()`, which creates a
  throwaway AppContainer profile and deletes it.

Conflating them fails in both directions. Deciding availability by platform name
claims `bwrap` on a Linux box that never installed it. Deciding build knowledge
by probing means a Linux machine sees a registry holding only a Windows backend,
finds it unavailable, and concludes containment exists and this host is
broken — when the truth is that nobody has written the Linux half yet.

## What it actually does, measured

From inside a container, against a real workspace, asking the kernel directly:

| Attempt | Result |
|---|---|
| Open, list and read the granted workspace | allowed |
| Create a file in a **read**-granted root | refused (error 5) |
| Create a file in a **write**-granted root | allowed |
| Read, list or write anything else — the user's Documents, their home, another project | refused (error 5) |
| Reach the network | refused; name resolution does not work |

Asserted in `tests/integration/sandbox-appcontainer.test.ts`, against the copy
in `vendor/`, so what is measured is what ships.

## Consequences

### It writes to the user's disk, and that has to be said plainly

Granting a workspace to a container adds one access-control entry, for a SID
that exists only for that workspace, to the project directory's security
descriptor. Every other entry is carried through untouched, and `pnpm
sandbox:release <project>` removes it. It is still a real modification to a
folder the user owns, and it is disclosed rather than buried.

It is a manual command rather than automatic cleanup on exit. A profile deleted
while a second Studio window is working in the same project would strip that
window's container mid-call, and "cleaned up correctly" is not worth that.

### The program runs even though the container cannot read it

`node.exe` runs contained while `C:\Program Files\nodejs` is refused to the
child, because the launcher opens the image with **its own** rights before the
container token applies. That is strictly better than granting the program's
directory: nothing has to be opened up, and the child cannot rummage through the
installation afterwards.

The limit that follows: a program that reads its own files *at runtime* rather
than only linking system libraries needs its directory granted. Python's
standard library is the case to expect.

### Linux is uncontained, and says so

`OS_ISOLATION_BACKENDS` is empty on Linux, so `ISOLATION_ENFORCED` is false there
and `execute` runs exactly as it did before. That is the honest transitional
state rather than a regression introduced by giving Windows a backend, and the
unit test asserts it per platform — so the day `bwrap` lands, the Linux branch
fails and this ADR has to be revisited rather than remembered.

### What is still not contained

`mcp-server` is classified `os` and is not yet routed through `LocalSandbox.run`;
it keeps its own stdio channel. That is the next piece of #15, and it is named
here so that "shell is contained" is not read as "everything is".

## The finding that changed the plan

The spike this work was planned around recorded that a contained child could
read a file but could not `dir` the folder holding it, and called enumeration an
open risk that might sink the design. **It was wrong.** `cmd /c dir` fails
inside a container for a reason of its own — it cannot open the working
directory it inherits — and reports it with the same "Access is denied." the
kernel uses. Asked directly, listing is allowed exactly when reading is.

A tool's error message is not a measurement. The probe that settled it is kept,
as `studio-contain probe`, rather than deleted with the spike.
