# ADR 0041 — Containment is the kernel's job

**Status:** Accepted · 2026-08-15 · extended 2026-08-16 with the Linux backend
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

### Getting the program to its first line

Containment applies at process creation, and the launcher opens the executable's
image with its **own** rights — so `node.exe` runs even though the contained
child cannot read `C:\Program Files\nodejs`. Good, and a trap: it makes
containment look complete one measurement too early. Two things the child still
reads for itself.

**Its own program files.** `node server.js` reads `server.js` from inside the
container, and an MCP server lives under the user's npm root, not in their
project. Granted read-only, at the nearest `node_modules` ancestor rather than
the script's own folder, because package managers hoist dependencies a level up
and a grant on the package alone leaves the server unable to load them.

**Every directory on the way there.** Resolving a path calls `realpath`, which
stats *every component* up to the volume root, and an AppContainer needs an
entry on each. This splits in two, and only one half needs a prompt:

| Ancestor | Owner | Granted to | When |
|---|---|---|---|
| `C:\`, `C:\Users` | the system | `ALL APPLICATION PACKAGES` | once, elevated, `pnpm sandbox:prepare` |
| `C:\Users\you\…`, `D:\projects\…` | the user | that workspace's own identity | automatically, no prompt, removed by `release` |

A traverse entry is traverse **and read-attributes, not `FILE_LIST_DIRECTORY`**:
the holder may confirm a directory exists and walk through it, and may not learn
what is in it. Non-inheriting, so it reaches nothing below. That is what makes
it acceptable on `C:\Users` — it says "this folder exists", which the folder's
name already said.

### `SetNamedSecurityInfo` walks children, and the volume root is why that matters

Changing a DACL with `SetNamedSecurityInfo` recomputes inherited entries on
every descendant. Correct for a project folder, catastrophic for `C:\`: run
elevated it is not refused, it simply never finishes. Non-inheriting entries use
`SetFileSecurityW`, which touches the named object only — 55 ms instead of
walking the disk. Which call is used is decided by the **mode**, on the way in
*and* on the way out, because revoking a traverse entry on a home folder with
propagation on is the same hang moved from startup to shutdown.

### The network is a capability, and the operator's switch now reaches it

`allowNetwork` used to bind only our own check; a subprocess ignored it
entirely, which is the gap this ADR exists to close. It is a kernel fact now:
`internetClient` is granted when the policy allows the network and withheld when
it does not. The boundary is narrower than "network access" — measured, with
every target verified reachable from *outside* the container in the same run, so
the refusals are refusals and not unreachable hosts:

| Target | no capability | `internetClient` |
|---|---|---|
| Public address, and DNS | refused | **allowed** |
| `127.0.0.1` | refused | **refused** |
| `192.168.x.x` | refused | **refused** |

Loopback stays shut under *every* capability Windows offers; opening it needs an
administrator exemption this will never ask for. So a contained server may call
its API and may not touch the user's dev server, local database, or router.

## What it actually does, measured

From inside a container, against a real workspace, asking the kernel directly —
on both platforms now. The Linux column was taken on Ubuntu 24.04 with
`kernel.apparmor_restrict_unprivileged_userns` lowered for the length of the run
and restored afterwards, which is the only way that machine can answer these
questions at all (#92).

The two mechanisms differ in a way worth naming: Windows *refuses* an ungranted
path, and Linux makes it *absent*. `EPERM` against `ENOENT` is the same boundary
reported from two directions, and the Linux one is marginally stronger — a path
that does not exist discloses nothing about whether it did.

| Attempt | Windows | Linux |
|---|---|---|
| Open, list and read the granted workspace | allowed | allowed |
| Run a program from a script *file*, not only `-e` | allowed | allowed |
| Create a file in a **read**-granted root | refused (error 5) | refused (`EROFS`) |
| Create a file in a **write**-granted root | allowed | allowed |
| Read, list or write anything else — their Documents, their home, another project | refused (error 5) | absent (`ENOENT`) |
| `~/.bashrc`, `~/.ssh/authorized_keys` | refused | absent |
| `/etc/passwd`, `/etc/shadow` | n/a | absent, network allowed or not |
| `/etc` at all, with the network **off** | n/a | absent |
| `/etc` with the network **on** | n/a | 7 entries — resolver and certificates, nothing else |
| See another process on the host | — | no; empty PID namespace |
| Reach the network, operator's switch off | refused; DNS does not resolve | refused |
| Reach the network, operator's switch on | allowed, loopback and LAN still refused | allowed, **loopback too** (#93) |

One Linux result is surprising enough to state rather than bury: listing the
home directory **succeeds**, and returns exactly one entry. To mount the child's
program root, `bwrap` has to create its mount point, which materialises every
parent as an empty directory inside the container. What a child sees of `$HOME`
is therefore the next component of the path to its own executable — which it was
handed in `argv[0]`. Nothing of the user's is there, and it is pinned by a test
so that if it ever becomes the real directory, something fails.

Asserted in `tests/integration/sandbox-appcontainer.test.ts`, against the copy
in `vendor/`, so what is measured is what ships.
`tests/integration/sandbox-bwrap.test.ts` asserts the same claims against a
Linux kernel, and asserts the *refusal* on a host that cannot contain — which is
the half that has actually been exercised so far.

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

### Linux is contained too, and by the distribution's own binary

`bwrap` is registered on Linux as of Stage 4b step 3. It needed no launcher of
ours — the distribution supplies one, reviews it, and ships its security updates
on its own schedule, which is a better trade than vendoring a sandbox and owning
its CVEs. So the Linux backend is an argument vector and a probe, and the two
platform directories are deliberately not the same size.

It also writes **nothing** to the user's disk. Windows adds an access-control
entry to the project directory and needs `release()` to take it back; a
namespace evaporates with the process it contained, so `release()` there is a
genuine no-op rather than an unimplemented one.

Two rules survive the change of mechanism, expressed differently. Read and write
roots are resolved to one mode per path on Windows, because `SetEntriesInAcl`
*replaces* a trustee's entry; on Linux they are ordered, because a later `bwrap`
mount wins. Same rule, two shapes, both pinned by a test.

### A backend that is installed and still does not work

The finding step 3 produced, and the one that justifies the probe existing at
all. On **stock Ubuntu 24.04**, `bwrap` 0.9.0 is installed at `/usr/bin/bwrap`
and an unprivileged user cannot use it:

```
$ bwrap --unshare-user  … -- /bin/echo hi
bwrap: setting up uid map: Permission denied
$ bwrap --unshare-all   … -- /bin/true
bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted
```

`kernel.apparmor_restrict_unprivileged_userns=1` since Ubuntu 23.10, and no
AppArmor profile grants `bwrap` `userns create`. A `process.platform === "linux"`
check would have claimed containment on that machine and run every shell command
open under a build that reports itself contained. That is the exact failure the
seam exists to prevent, and it is not an edge case — it is the default state of
one of the most widely deployed Linux distributions.

So this host **refuses**, which is correct, and the refusal now quotes what the
kernel actually said. The remedy sentence beside it is a list of things known to
produce that class of failure, kept separate from the observation on purpose:
deciding the cause and printing only the fix is how an `ETIMEDOUT` got reported
as "run as administrator" to someone already elevated. Making that refusal
survivable is the Linux counterpart of `pnpm sandbox:prepare`, and it is below.

### The way out, and the three ways it lied on the way there

`sudo pnpm sandbox:prepare` writes `/etc/apparmor.d/studio-bwrap`: a profile that
names `bwrap` and grants it `userns`. Not the sysctl. Lowering
`kernel.apparmor_restrict_unprivileged_userns` is one line and it works, and it
removes the protection **for every program on the machine** in order to switch
one sandbox on — an agent that asks its user for that is doing the thing the
sandbox exists to prevent. The profile is narrower by exactly one program, and it
is not an invention: `/etc/apparmor.d/` on a stock desktop already carries the
same shape for Brave, Chrome, VS Code and flatpak.

What is worth recording is not the profile but what running the command taught,
because **every defect below survived code review, type-checking and a green
suite, and each one made the command claim success while doing nothing.**

1. **It measured the wrong person.** The pre-check probed the process asking, and
   under `sudo` that is root — which holds `CAP_SYS_ADMIN`, so AppArmor's
   `userns` rule never applies to it. The command reported that the sandbox
   already worked and installed nothing, one line after the identical `bwrap`
   invocation had failed for the user. A setup command has to ask about *the
   account that will run the thing*, and `unprivilegedIdentity` is that mapping.
2. **The undo ran its two steps in the wrong order.** It deleted the profile,
   then asked `apparmor_parser -R` to unload it — and `-R` reads the file to
   learn which profile to unload. So the file went, the grant stayed, and the
   command printed that the sandbox would refuse work again while `bwrap` went on
   containing perfectly well. The failure was swallowed by a `catch` whose
   comment correctly described the very outcome it was producing.
3. **The file was treated as the truth.** Fixing (2) left machines in a state —
   profile loaded, file gone — where the undo answered "not installed" while the
   grant was live. True about the filesystem, false about the machine.
   `/sys/kernel/security/apparmor/profiles` is what the kernel is actually
   enforcing, and the undo now writes the file back in order to take the grant
   away.

The shape they share is the one this ADR is about. Each was a question answered
from the wrong source — the caller instead of the user, the comment instead of
the argument order, the disk instead of the kernel — and in each case the wrong
source agreed with the right one on the machine where the code was written. That
is why the install path re-probes after `apparmor_parser` exits zero, and why the
undo re-reads the kernel after unloading: a setup command that reports success
while the thing stays broken is worse than one that fails, because the user stops
looking. Closes **#92**.

### The network switch does not mean the same thing on both platforms

One boolean, two boundaries, and the difference is measured on both sides rather
than argued from the flags:

| Target | Windows, `internetClient` | Linux, `--share-net` |
|---|---|---|
| Public address and DNS | allowed | allowed |
| `127.0.0.1` | **refused** | **reached, 200** |

Windows can be narrow because a capability names what it grants. Linux cannot,
because `bwrap` offers nothing between "empty namespace" and "the host's" —
narrowing it needs a firewall rule or a seccomp filter this does not have. The
**refusal** half is identical and complete on both; the **granted** half is
wider on Linux, so a contained server there may call its API *and* the user's
dev server. Registered as **#93**, and written into
`ContainmentRequest.network`'s own doc comment rather than only here, because
that is the field whose name implies otherwise.

### `network` stopped requiring `os`, and that is not a relaxation

`EFFECT_RULES.network.isolation` was `os`, for a reason that was true about a
subprocess: nothing in userspace Node stops one opening a socket. But a
subprocess's network is now decided by the kernel where the subprocess is
created, from the operator's `allowNetwork` switch. Asking the same question
again in the effect table only ever reached capabilities that start **no child
at all** — our own `web_fetch`, an HTTPS request from the harness process — and
refused them because somebody else's sandbox was unavailable.

Nothing had ever run on a host that registers a backend and cannot use it, so
the two answers had always coincided. Ubuntu 24.04 was the first machine to tell
them apart, and it did so by disabling the web tools. Containment is a property
of the **kind** of child (`isolation/kinds.ts`); the effect table says what an
effect needs of the harness. Conflating them is the second taxonomy this ADR
opens by refusing, arriving from the other direction.

### MCP servers are contained, with the network granted by default

`mcp-server` reaches the same verdict as `shell`, through the same function.
They are spawned by completely different code — one waits for an exit, the other
streams for a session — so the launcher cannot use `LocalSandbox.run`; it asks
`containCommand` and spawns its own way. A second copy of the decision is what
`T-28` was.

The network is granted to every contained server, and that is the honest
position rather than the ideal one: a server record carries no field saying
whether it needs the internet, most exist to call an API, and shipping them all
offline would produce a sandbox users switch off. The filesystem boundary lands
in full regardless. Registered as **#90** — a declared per-server network
capability, surfaced in the install dialog.

### What is still not contained

macOS, by decision rather than omission — Stage 4b put it out of scope — so a
Mac registers no backend, enforces nothing, and behaves exactly as it did.

And any Linux machine whose kernel withholds user namespaces, which refuses
rather than running open. That is the intended behaviour and it is also a
usability cliff: on such a host the shell tool and every stdio MCP server stop
working until #92 gives the user a way through.

## The finding that changed the plan

The spike this work was planned around recorded that a contained child could
read a file but could not `dir` the folder holding it, and called enumeration an
open risk that might sink the design. **It was wrong.** `cmd /c dir` fails
inside a container for a reason of its own — it cannot open the working
directory it inherits — and reports it with the same "Access is denied." the
kernel uses. Asked directly, listing is allowed exactly when reading is.

A tool's error message is not a measurement. The probe that settled it is kept,
as `studio-contain probe`, rather than deleted with the spike.

**The same mistake then happened twice more, in the other direction.** The first
traversal fix granted the volume root, because `C:\` was what the error named —
and the next run failed on `C:\Users`. Then an `ETIMEDOUT` from an
already-elevated terminal was reported as "run as administrator", which sent the
investigation at the wrong wall entirely: the call was working, it was walking
the disk.

An error names the first thing that failed. It never names the shape of the
problem, and reading one as the other is how a fix ships half-done.

**And the tests were shaped to miss it.** Every case in
`sandbox-appcontainer.test.ts` used `node -e`, the one invocation form that
never resolves a main module — ten green tests all taking the same shortcut, past
a containment that broke `node build.js`. There is now a case that runs a script
*file*, and removing the traversal fix fails that one and no other, which is the
measurement of how blind the rest were.
