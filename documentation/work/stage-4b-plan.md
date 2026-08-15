# Stage 4b — the real sandbox (#15, carrying #32 and #41)

**Status:** Spike complete, implementation not started · **Opened:** 2026-08-15
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

Two limits found in the same run, both of which shape the implementation:

- **`dir` on the granted directory was refused while reading a file inside it
  succeeded.** Enumeration and file-open are separate rights and the `(OI)(CI)(RX)`
  grant used in the spike was not sufficient for the former. This has to be
  resolved during implementation, not hand-waved: a tool that cannot list the
  workspace is not usable.
- **`icacls D:\ /grant` fails with exit code 5 — access denied.** Anything
  requiring an ACE on a drive root needs elevation and is therefore not
  available. The spike shows this is not needed for file reads; it may be needed
  for enumeration, and if it is, that is a finding that changes the design.

The spike is deleted. It lived in the scratchpad, its two AppContainer profiles
were removed (`DeleteAppContainerProfile` → `hr=0x0`), and its ACEs went with
the directory tree it created.

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

**Unverified, and named as such:** no Linux machine is available, so every
statement about `bwrap` in this document is from its documented interface and
not from a run. The argv construction can be unit-tested without it; the
containment cannot.

## 4. Sequence

Each step lands on its own and is verifiable on its own. No step claims #15.

1. **The seam.** `SandboxFactory` behind the ADR 0035 ports; the kind-to-tier
   table above stated in one module beside the environment policy it mirrors.
   `assertSupports` stops falling through and throws `unsupported_isolation`
   when no backend can supply what an effect needs — **which closes #32** and
   makes the current state loud instead of silent. Nothing is contained yet, and
   the capability list the model sees becomes honest about that.
2. **The Windows backend.** The helper binary, the profile lifecycle, the ACE
   grant and revoke, and the enumeration limit from §2 resolved. Tested on this
   machine, which is now possible at all because of #87.
3. **The Linux backend.** `bwrap` argv, probed availability, unit-tested
   construction. Marked unverified until it runs on Linux.
4. **#41.** The containment text in the README and ADRs 0019/0022/0024 is
   corrected *last*, because until steps 2 and 3 land the true statement is "not
   yet contained", and writing it before then would be the third wrong claim in
   that paragraph's history.

## 5. What could still sink this

Recorded now so that finding one later is not a surprise:

- **Enumeration.** If listing a directory turns out to need an ACE on the drive
  root, Windows containment needs elevation and step 2 needs a different answer.
- **ACLs are a side effect on the user's disk.** Granting a per-workspace
  AppContainer SID writes to the project directory's security descriptor. It is
  reversible and scoped to a folder the user already bound, but it is a real
  modification and the ADR has to say so plainly.
- **Every tool must still work.** A sandbox that contains `git` into
  uselessness has cost more than it bought. The first-party row of §3.1 exists
  precisely to prevent that, and it is the part most likely to be got wrong.
