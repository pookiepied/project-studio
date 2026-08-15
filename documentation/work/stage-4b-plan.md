# Stage 4b — the real sandbox (#15, carrying #32 and #41)

**Status:** Steps 1-3 landed — both platforms have a backend; #41 is what is left ·
**Opened:** 2026-08-15 · **Last measured:** 2026-08-16 (Ubuntu 24.04, VPS)
**Register:** `phases-1-11-remediation.md` #15, #32, #41 · **Blocked on:** nothing

The decision was already taken and is not reopened here: **option (a), a real
sandbox** — Windows and Linux, macOS explicitly out of scope. *"Real sandbox, or
else we're going to take the heavy weight of half or bad implementation once
again."* This document exists to record what was measured before any of it was
built, and to say what the shape has to be as a result.

---

## 1. What is true today

`LocalSandbox` provides `in-process` isolation. `contracts/effects.ts` says
`execute` and `network` require `os`. `assertSupports` compares the two and,
when the check fails, **does nothing**:

```ts
if (satisfiesIsolation(this.isolation, requiredIsolation(effect))) continue;

// No isolation for this effect, and we run it anyway.
```

That is honest in its comment and inert in its behaviour, and it is the whole of
#15. `sandbox/errors.ts` already declares `unsupported_isolation`, thrown
nowhere — #32, which stops being a dead-code question and becomes the error this
branch is supposed to raise once there is a factory that can fail to find a
backend.

## 2. The spike, and what it measured

Run on the actual target: Windows 11 **Home**, build 26200.

**Ruled out by the edition, not by preference.** Windows Sandbox is Pro and
Enterprise only and `WindowsSandbox.exe` is absent here; Hyper-V and Windows
containers likewise. Any design resting on them is a design that does not run on
the machine this is being built on, and Home is the most common consumer SKU.
`wsl.exe` and `docker` are present but put the tool in a different filesystem,
which defeats the point — the agent's job is to edit the user's project in
place.

That leaves **AppContainer**, which is a kernel token feature and not an edition
feature. Three things were measured rather than assumed:

| # | Question | Result |
|---|---|---|
| 1 | Can a profile be created without elevation? | **Yes.** `CreateAppContainerProfile` → `hr=0x0`, SID derived, profile deleted cleanly. |
| 2 | Can a child be spawned into it? | **Yes.** `STARTUPINFOEX` + `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` + `CreateProcessW`. The child ran `cmd.exe`, so it reached `C:\Windows\System32` — traverse to system paths is not blocked. |
| 3 | Does containment actually bite? | **Yes.** With one `icacls` ACE on a workspace directory, the child read a file there (`type` → `hi`) and was refused a sibling directory it had no ACE for (`Access is denied`). |

Two limits were recorded in the same run. **The first one was not real, and
finding that out is the most important thing step 2 produced.**

- ~~**`dir` on the granted directory was refused while reading a file inside it
  succeeded.**~~ **Withdrawn 2026-08-15.** The spike measured this through
  `cmd /c dir`, and `dir` fails inside a container for a reason of its own — it
  cannot open the working directory it inherits — while reporting it with the
  same "Access is denied." the kernel uses. Asked directly, with
  `studio-contain probe` calling `CreateFileW` and `FindFirstFileW`, listing is
  allowed exactly when reading is. Enumeration was never a limit; it was a
  measurement taken through a program with opinions. The whole of §5's first
  risk followed from it.
- **`icacls D:\ /grant` fails with exit code 5 — access denied.** Real, and
  still true: an ACE on a drive root needs elevation. It turned out not to
  matter, because nothing needs one. The workspace's own directory is where the
  grant goes, and the launcher opens the *program* with its own rights before
  the container token applies — so the program's install directory never has to
  be granted, and the contained child cannot read it either. What the child
  *does* need is every **ancestor** of its own path, which is a separate finding
  and the one that cost the most: see ADR 0041 and `windows/traversal.ts`.

The spike is deleted. It lived in the scratchpad, its AppContainer profiles
were removed (`DeleteAppContainerProfile` → `hr=0x0`), and its ACEs went with
the directory tree it created. Its one durable output is the probe, which was
kept as a `studio-contain` subcommand rather than thrown away with it — the
thing that corrected the enumeration finding is worth having the next time a
containment question needs an answer that `cmd` cannot give.

## 3. The shape this forces

### 3.1 Containment is the same taxonomy as inheritance

ADR 0039 already names the kinds of child process this system starts and gives
each one an environment policy. **Containment belongs on that same axis**, and
adding a second, parallel taxonomy for it is exactly the mistake 0039 was
written to stop.

| Kind | Who chose the program | Environment (0039) | Isolation |
|---|---|---|---|
| Harness | us | `HARNESS_INHERITED_VARIABLES` | none — it *is* the trusted process |
| First-party tool (`git`, `rg`) | us | `buildEnvironment()` | none needed; we wrote the call sites |
| Shell command | **the model** | `buildEnvironment()` | **`os`** |
| MCP server | **a third party** | `buildEnvironment(declared)` | **`os`** |

This matters concretely: `runProcess` in `process/exec.ts` is the single spawn
point for *all* of these, including the `git` calls that snapshots depend on.
Containing it wholesale would break the undo system. The tier has to be a
property of the kind, decided in one module, not a flag each call site passes.

### 3.2 A launcher, not a library

Containment on Windows requires Win32 calls (`CreateAppContainerProfile`,
`UpdateProcThreadAttribute`, `CreateProcessW`) that Node cannot make. The three
options are a native addon (no), moving tool execution into the Tauri Host (a
rewrite), or **a small helper binary that applies a policy and execs**.

The helper is the answer, and it is the same shape Linux already has: `bwrap`
*is* that helper, supplied by the OS. So the contract is one command line —
"run this program under this policy" — with a platform-chosen launcher behind
it.

- **Linux:** `bwrap`, an external dependency. Its presence is a runtime fact to
  probe, not to assume, and its absence is what `unsupported_isolation` reports.
- **Windows:** a new Rust binary. It needs building and shipping, which is a
  real build-system consequence — the Harness's test suite would depend on a
  Rust artefact for the first time.

~~**Unverified, and named as such:** no Linux machine is available, so every
statement about `bwrap` in this document is from its documented interface and
not from a run.~~ **Resolved 2026-08-16.** A Linux VPS was made available and
every `bwrap` statement below is now from a run on it. The sentence is struck
rather than deleted because the shape of the caveat was right: the argv
construction was unit-testable without a Linux machine and the containment was
not, and it stayed unclaimed until one existed.

## 4. Sequence

Each step lands on its own and is verifiable on its own. No step claims #15.

1. **The seam.** ✅ *Landed `df37d43`.* The kind-to-tier table stated in one
   module beside the environment policy it mirrors; `assertSupports` stops
   falling through and throws `unsupported_isolation` when no backend can supply
   what an effect needs — **which closed #32**. Nothing was contained yet, and
   the code said so as data rather than as a comment.
2. **The Windows backend.** ✅ *Landed.* `native/windows-appcontainer/`, shipped
   as `vendor/win32-x64/studio-contain.exe`; profile lifecycle, ACE grant and
   revoke in-process via `SetEntriesInAcl`; `shell` **and** `mcp-server` both
   route through one verdict, `containCommand`. Measured on this machine — see
   §2 and ADR 0041. Four things it changed that were not in the plan: the
   enumeration limit was withdrawn as a measurement error; `LOCALAPPDATA` turned
   out to be required by `CreateProcessW` itself; a contained program must be
   able to stat **every ancestor** of its own path, which costs one elevated
   command per machine; and `SetNamedSecurityInfo` propagates to every
   descendant, so applying that entry to a volume root with it never returns.
3. **The Linux backend.** ✅ *Landed 2026-08-16.* `src/sandbox/isolation/linux/`,
   `bwrap` resolved through the existing vendor resolver as system-only, argv
   built by a pure function and unit-tested on every platform, availability
   probed by containing `/bin/true`. Nothing is written to the user's disk, so
   `release()` is a no-op with a reason rather than a gap.

   **Verified on a real Linux machine, in both states.** The VPS runs Ubuntu
   24.04, which has `bwrap` installed and refuses it a user namespace — so the
   *refusal* path was measured end to end exactly as shipped: `available()`
   false, `unsupported_isolation` raised, the kernel's own words quoted back.
   The restriction was then lowered for a single session and restored, which
   ran the containment matrix itself: workspace read/list/write, a script
   *file* rather than only `-e`, refusal of everything outside, an empty PID
   namespace, `/etc` absent unless the network is on and then only seven
   entries, and the network switch in both positions. One result came back
   different from Windows and is #93.
4. **#41.** The containment text in the README and ADRs 0019/0022/0024 is
   corrected *last*. What it must now say is **platform-specific** — contained
   on Windows, not yet on Linux — which is a third distinct statement from
   either of the two wrong ones already in that paragraph's history, and a
   reason not to write it before step 3 lands.

### Still open inside #15

Named here so that "the sandbox works" is not read as more than it is:

- **A Linux machine whose kernel withholds user namespaces refuses everything.**
  #92. Correct, and a cliff: on stock Ubuntu 24.04 the shell tool and every
  stdio MCP server stop working, with a message and no way through. Windows has
  the same shape of problem and an answer — one elevated `pnpm sandbox:prepare`
  — and Linux needs its counterpart.
- **The Linux network switch is wider than the Windows one.** #93. `--share-net`
  shares the host's namespace, loopback included; `internetClient` does not.
  The refusal half matches; the granted half does not.
- **A contained MCP server is given the internet unconditionally** — #90. The
  filesystem boundary is complete; the network is granted to every server
  because no record says whether one needs it. The capability is
  `internetClient` alone, measured to exclude loopback and the LAN, so even the
  default cannot reach a local service.
- **Windows needs one elevated command per machine.** `pnpm sandbox:prepare`
  adds a traverse entry to the system-owned ancestors of a project — `C:\` and
  `C:\Users` in practice. Everything under the user's own folders is granted per
  workspace, silently, and removed again by `sandbox:release`.
- **Profiles accumulate one per project.** Bounded in production and removable
  with `pnpm sandbox:release <project>`, but nothing removes them on its own.
  The test suite made this visible by minting a workspace per run and leaving
  fourteen profiles behind; `tests/sandbox-profiles.ts` now removes the
  difference a run created, and deliberately not everything matching the name.

## 5. What could still sink this — and what actually did

Recorded before the work, and now marked with what happened.

- ~~**Enumeration.**~~ **Did not exist.** See §2. The risk was real as written
  and false as measured, and it is left in this document rather than deleted
  because the lesson is the durable part: the spike's evidence was a program's
  error message, not the kernel's answer.
- **ACLs are a side effect on the user's disk.** **Confirmed, and disclosed.**
  One access-control entry per granted root, for a SID that exists only for that
  workspace, added without disturbing any other entry. ADR 0041 says so plainly
  and `pnpm sandbox:release` removes it. This is the cost of the feature, and it
  is a real one.
- **Every tool must still work.** **Held, and it was close.** The first version
  of the grant applied write roots and then read roots as two passes;
  `SetEntriesInAcl` *replaces* a trustee's entry rather than adding to it, and
  the workspace root is on both lists — so read won and the agent could read its
  own project but not write to it. A plausible-looking sandbox and a useless
  agent. Caught by the integration test, fixed by resolving the mode per path
  before applying anything, and pinned by a unit test that needs no Windows.

## 6. What was measured, and where it is asserted

Nothing in ADR 0041 rests on this document. Every claim is re-asserted in
`tests/integration/sandbox-appcontainer.test.ts`, against the launcher in
`vendor/` rather than the one in `target/`, so what is tested is what ships.
The suite skips loudly on a machine with no backend rather than passing: a green
run on Linux for a Windows feature would be the same class of untrue claim this
whole cycle exists to remove.

Baseline after step 3, on Node 24.19.0, on both platforms — which is itself new,
since every figure in this document before it came from one machine:

| | Windows 11 Home 26200 | Ubuntu 24.04 (VPS) |
|---|---|---|
| Files | 79 passed, 1 skipped | 79 passed, 1 skipped |
| Tests | 1227 passed, 19 skipped, 0 failed | 1221 passed, 26 skipped, 0 failed |
| `tsc --noEmit` | clean | clean |
| `flue build --target node` | clean | clean |
| Containment | measured working | measured working, **and measured refusing** |

The Linux figures are from the session with the userns restriction lowered. As
that machine normally stands, it reports **77 passed, 3 skipped / 1189 passed,
57 skipped, 0 failed** instead — the difference being every case that has to
start a real program, gated by `tests/contained.ts`. Both numbers are real and
both are worth keeping: the first says the sandbox works, the second says the
refusal works, and no single run can say both.

Skipped, never quietly passed. A suite reporting green where the feature could
not be exercised is the class of claim this cycle exists to remove.
