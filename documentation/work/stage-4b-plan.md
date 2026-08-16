# Stage 4b — the real sandbox (#15, carrying #32 and #41)

**Status:** All four steps landed — both platforms contain; §4 lists what still blocks shipping ·
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
4. **#41.** ✅ *Landed 2026-08-16.* The containment text, corrected last and for
   the reason the execution order gave — writing it before both backends existed
   meant writing it twice. What it says now is **conditional** rather than
   platform-specific, which is a *fourth* distinct statement and the first one
   that survives a machine that cannot contain: `shell` and `mcp-server` are
   contained by the OS on Windows and on Linux, on a host whose kernel will
   supply it, and a host that will not is refused rather than run open. Struck
   rather than deleted everywhere it was wrong; `documentation/archive/` left
   alone, because it is the evidence of how the claim drifted.

### Still open inside #15 — the complete blocker list

**Verdict: the containment is done and the shipping story is not.** Both
platforms contain a model-chosen program, and both were measured doing it
against a real kernel rather than described. What is not finished is everything
around that: a Linux user cannot reach the working state without editing kernel
settings by hand, and the boundary a granted network draws is not the same on
the two platforms. Ranked by what stands between this and shipping.

*Updated 2026-08-16: the first two are closed — a Linux user reaches the working
state with one command and no kernel edit, and a granted network now draws the
same boundary on both platforms. The list is kept in its original order and
marked, rather than rewritten, because what each item failed to anticipate is
the useful part: #92 did not foresee that the setup command would measure the
wrong account, and #93 predicted a firewall rule it turned out not to need.*

#### 1. Linux is correct and unusable out of the box — #92 — **closed 2026-08-16**

**Closed.** `sudo pnpm sandbox:prepare` installs
`/etc/apparmor.d/studio-bwrap`, granting `userns` to `bwrap` and nothing else;
`--undo` unloads and removes it. Verified end to end on the VPS with the sysctl
left at **1** the whole time — refused, prepared, contained, full Linux suite
green at 1234 with every containment assertion running, undone, refused again.

The blocker text below stands as written, because the part worth keeping is what
it did *not* predict: three defects, all of which made the command report success
while changing nothing, and none of which a test written from the code would have
caught — it probed root instead of the user, it deleted the profile before the
command that needed the file to unload it, and it then read the disk instead of
the kernel to decide whether the grant was gone. ADR 0041 records them, since the
shared shape — answering from a source that happens to agree on the machine where
the code was written — is more durable than any of the three fixes.



**The blocker.** Stock Ubuntu 23.10 and later set
`kernel.apparmor_restrict_unprivileged_userns=1` and ship no AppArmor profile
granting `bwrap` `userns create`, so an unprivileged user cannot obtain a
namespace. The backend probes this, finds it, and refuses — which is right, and
which means the shell tool and every stdio MCP server stop working on one of the
most widely deployed Linux distributions.

The only way this was made to work was lowering that sysctl by hand for one
session. **That cannot be the instruction shipped to a user:** it is a
machine-wide control, and telling people to weaken it to run our agent is
precisely the trade this whole stage exists to avoid making silently. The likely
answer is an AppArmor profile the installer places, because that is the
mechanism Ubuntu expects of shipped applications — `/etc/apparmor.d/` already
carries profiles for Chrome, VS Code and flatpak for exactly this reason.

Windows has the same shape of problem and already has its answer: one elevated
`pnpm sandbox:prepare` per machine. Linux needs its counterpart.

#### 2. A granted network means more on Linux than on Windows — #93 — **closed 2026-08-16**

**Closed.** `pasta` (from `passt`) builds the namespace in userspace and
bubblewrap shares *that* instead of the machine's. Internet reached, host
loopback refused, RFC1918 refused, carrier-grade NAT refused, and the child
cannot take the routes back off. A machine without `passt` is refused a network
rather than quietly handed `--share-net`.

The prediction below — "closing this needs a firewall rule or a seccomp filter"
— was wrong in an instructive way. It needed neither: a second namespace and
five blackhole routes. The guess came from asking what `bwrap` could do rather
than what was available to compose with it. ADR 0041 has the measured table and
the three findings that only running it produced.



**Measured, not deduced.** With the operator's switch on, a contained child on
Linux reached a server on `127.0.0.1` (`200`); on Windows the same attempt is
refused, and loopback stays shut under every capability Windows offers. So a
contained MCP server on Linux may call its API *and* the user's dev server,
local database or router.

`bwrap` offers nothing between "empty namespace" and "the host's stack", so
closing this needs a firewall rule or a seccomp filter. The **refusal** half is
identical and complete on both platforms; only the granted half diverges.

#### 3. Every MCP server is given the internet — #90

The filesystem boundary is complete for `mcp-server` on both platforms. The
network is granted to all of them, because `McpServerRecord` carries no field
saying whether one needs it, and shipping every server offline would produce a
sandbox users switch off. This is a schema field, a migration and a dialog line
— `ContainmentRequest.network` already takes the boolean. On Windows the default
is narrow (`internetClient`, no loopback, no LAN); on Linux it is as wide as #93
says.

#### 4. Windows profiles accumulate, one per project — #94

Creating a container mints an AppContainer profile and writes one access-control
entry into the project directory. `pnpm sandbox:release <project>` takes both
back, and nothing does it automatically — deliberately, because deleting a
profile while a second Studio window works in the same project would strip that
window's container mid-call. Bounded and disclosed rather than unbounded, but it
is still state this feature adds to a user's machine and never removes on its
own.

#### 5. ~~The containment text is still wrong~~ — #41 ✅ closed 2026-08-16

Was the only documentation item on this list. ADRs 0019/0022/0024,
`phases/roadmap.md` and the harness README now carry the conditional sentence;
the archive is deliberately untouched. Chasing it also surfaced **#95** — ADR
0022's untrusted-bytes half is entirely unaffected by containment, and an MCP
server's result is the one place that argument was never applied.

#### Not blockers, recorded so they are not mistaken for gaps

- **macOS is out of scope by decision**, so it registers no backend, enforces
  nothing, and behaves exactly as before.
- **Windows needs one elevated command per machine.** `pnpm sandbox:prepare`
  adds a traverse entry to the system-owned ancestors of a project — `C:\` and
  `C:\Users` in practice. Everything under the user's own folders is granted per
  workspace, silently, and removed by `release`. This is finished work, and it
  is the model #92 copied: same command, same sentence to the user, a different
  mechanism underneath.
- **A program that reads its own *data* files from a protected directory cannot
  be contained on Windows.** The launcher opens the executable's image with its
  own rights, so the program runs without its install directory being granted —
  but a runtime that reads its own library at run time needs that directory.
  Python's standard library is the case to expect. Stated as a limit in ADR
  0041 rather than tracked as a defect.

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
