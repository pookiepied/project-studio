# 0057 — The Gate Is the Boundary

**Status:** Accepted
**Date:** 2026-09-19
**Supersedes in part:** [ADR 0041](0041-containment-is-the-kernel-s-job.md) —
the Windows half: the AppContainer launcher, the traverse and corridor
grants, the ledger, `pnpm sandbox:prepare` and `sandbox:release`. The Linux
half stands, narrowed below.
**Supersedes:** [ADR 0047](0047-a-contained-command-can-find-the-programs-it-may-run.md) —
program discovery for a contained command. There is no contained command on
Windows to discover anything for.
**Amends:** [ADR 0018](0018-trust-and-modes.md) — three execution modes become
two. Trust is unchanged.
**Builds on:** [ADR 0012](0012-permission-and-containment.md) — the kernel
decides, never executes, never prompts. Everything here is subtraction under
that rule; nothing new is decided about permission.
**Evidence:** `documentation/work/sandbox-simplification-plan.md`, the
measurements of 2026-09-19.

## Context

Studio has two layers between the model and the machine, and they must be kept
apart to see the problem.

The **gate** (`CallGate.call`, ADR 0012, 0015, 0020) is one door for every
executable call. Effects are classified in one table; approvals are scoped to
a `scopeId` the model can never author; network destinations are derived by our
code, with loopback, link-local, private ranges and metadata addresses refused
before any question is put; credentials live in the OS store. This layer works,
is tested, and is the whole security story of every other coding harness on
Windows and macOS.

The **OS sandbox** (ADR 0041) sits under the gate. Once a command is approved,
it runs as a real process, and the sandbox fences that process so an approved
command still cannot touch files outside its scope. On Linux the fence is
`bwrap`: a namespace set at process creation, gone when the process exits,
writing nothing to disk. On Windows it is AppContainer, and AppContainer is
not a fence around a process. It is a Store-app packaging model, and making it
hold a developer's shell means **writing access-control entries onto the real
filesystem** — on the project, on every toolchain directory, and on every
ancestor from the volume root down — and then owning them.

What owning them cost, measured on 2026-09-19:

- `C:\Users\pooki\AppData` carried about **100** stale per-workspace
  AppContainer SID entries and `AppData\Local` about **1,360**. Windows caps an
  ACL near 1,800. The code already contained `#advisePreparation`, whose job
  was to warn that these directories take one entry per workspace; the design
  predicted its own failure.
- `ensureTraversable` in `isolation/windows/traversal.ts` placed `AppData` and
  `AppData\Local` in no bucket at all, `grantCorridor` threw, and a `catch`
  accepted the weaker machine-wide traverse entry as satisfied under a comment
  admitting it is enough for every contained program *except git*. So git
  failed with `unable to get current working directory: Permission denied`
  and nothing said why. That is the long-red
  `tests/integration/sandbox-scope.test.ts` case.
- `71bbec4d` fixed a symptom of the same mechanism: every project-less
  conversation minted its own identity and re-granted every root, measured at
  about a hundred seconds before the first command.
- Bash from Git for Windows dies inside the container with
  `STATUS_DLL_INIT_FAILED`, so the shell tool ran `cmd.exe`, so the model —
  which expects a POSIX shell — wasted a call learning that in every
  conversation.
- Two limits were already recorded as unfixable inside a container: the `py`
  launcher finds Python through the registry, and Flutter's Dart VM cannot
  run under AppContainer.

To manage all this, `src/sandbox` grew to about 6,300 lines: the launcher, the
traversal walk, a ledger (`windows-profiles.json`), three in-process caches, an
elevated preparation step, a release command, a maintenance command, and a
preset per toolchain naming where Python, Java, Rust, pnpm and Flutter live.
Most of that is not a sandbox. It is bookkeeping for one.

For calibration: Claude Code contains commands with `bubblewrap` on Linux and
Seatbelt on macOS and has **no** OS sandbox on Windows. Codex CLI's Windows
containment is late, experimental, and built on the same restricted-token
family. Nobody has made Windows containment work reliably for developer
tools, and the reason is structural, not effort.

## Options

**Keep patching AppContainer.** Widen the machine-wide entries, sweep stale
SIDs, add buckets to the traversal walk as they are found. Each patch buys
weeks. The mechanism still writes to the user's disk on every workspace, still
accumulates, still cannot run bash, `py` or Dart. Rejected: the failure mode
is the design, not a bug in it.

**Run commands in WSL or Docker.** A Linux container where `bwrap` works, with
the project mounted in. Real containment, at the price of requiring WSL or
Docker Desktop, a second filesystem view of the project, slower file I/O,
extra memory held for the length of the session, and every Windows-native
toolchain (MSVC, .NET Framework, Windows SDKs) out of reach. Rejected as the
default; the seam below leaves room for it as an opt-in backend if it is ever
wanted.

**Delete the Windows containment and let the gate be the boundary.** Chosen.

## Decision

**The gate is the security boundary. An OS sandbox, where the platform offers
one worth having, is an extra fence under it — never a requirement, never a
mechanism with side effects on the user's disk.**

### Windows: no containment

`src/sandbox/isolation/windows/` is deleted, with `native/windows-appcontainer/`,
the vendored `studio-contain.exe`, the ledger, `pnpm sandbox:prepare`,
`sandbox:release`, `sandbox:list`, and their tests. `hostIsolation` on Windows
answers "none", and the sandbox policy is a no-op when isolation is none. The
gate continues exactly as before: every effectful call is classified, scoped,
and asked or refused.

### Linux: `bwrap` stays, exactly as written, as an extra fence

The Linux backend (`isolation/linux/`) is untouched by this decision. It has no
side effects to own, and the measurements in ADR 0041 stand. Two things change
about how it is treated:

- It is **opt-in**, not the default. A person on Linux turns it on (the
  "Sandbox fence" switch on the Environments page, stored as a setting and
  applied process-wide like the shell choice); a build never claims
  containment it was not asked for. On a platform with no backend the
  switch is not offered and the stored value means nothing.
- When it is on and cannot start — `bwrap` missing, user namespaces withheld,
  `passt` absent for a networked command — the command runs **gate-only, with
  a visible note** saying so, instead of refusing. ADR 0041 refused here, and
  that was right while the sandbox was the boundary; now the gate is, and a
  Linux host that cannot fence a process is in the same position as every
  Windows host, which is a position the design accepts.

It has been exercised on one Ubuntu machine and on CI's refusal path, and not
on a real desktop for the length of a working day. It is kept as is so that
day can happen, and it will be fixed then, on that machine, against what the
kernel actually says. Nothing built now depends on it working.

### The shell is the user's shell

The shell tool runs what the machine has, with the machine's `PATH`: bash from
Git for Windows when present, else PowerShell, else `cmd.exe`, with a setting
to choose, and the chosen shell named in the environment block the model
reads. The policy `PATH` rebuilt from the disk, and the toolchain presets that
told the container where Python, Java, Rust, pnpm and Flutter live, go with
the container. The machine's `PATH` already answers that question.

### Two modes

ADR 0018's three modes become two:

| Mode | What it does |
|---|---|
| **Ask** | Every effectful call asks, unless a rule the person wrote allows it. Reads do not. |
| **Auto** | Every default `ask` proceeds. Policy `ask` still asks. |

Auto Edit existed to draw a line between editing and running, and the line
was drawn there because running was the thing the container was for. Without
the container, "edit without asking, ask before running" is one allow rule
under Ask - the first write question answered "this project, always" - not a
third mode. The rules the person wrote apply in both modes; the mode says
only what happens to the `ask` no rule covers. Stored rows are rewritten
once, in the safe direction: Manual and Auto Edit read as Ask, Full Auto as
Auto (migration 25). ADR 0018's invariant is unchanged and load-
bearing: **a mode may only resolve an `ask` that came from the default.** A
policy `ask` — a connected server about to run code — is never touched by any
mode. Auto still requires a working undo, for ADR 0018's reason.

### A scope question is a rule, not an ACL

The scope question (`sandbox/scope-questions.ts`) — a refused path becomes a
question with the resolved path in it, and a yes becomes a grant — **stays**,
and becomes cheap. Under ADR 0041 a granted path meant an inheritable ACL entry
propagated down a tree the user's tools were watching; that cost is why the
question was asked reluctantly. Now a grant is a row the gate consults: the
model may use `~/Downloads` for this conversation, or for this project, or
always, and the answer is stored where every other user decision is stored
(ADR 0036) and withdrawn the same way. The scope store's preset source loses
its meaning with the container and is retired; `read`/`write` mode and the
`question`/`custom` sources stay. The project's `level` (`contained` /
`trusted`) **stays**, corrected here from an earlier draft that retired it:
without a container it still decides something real, namely whether the
project folder plus its grants are the boundary the file tools stop at and
ask beyond, or whether the whole machine is in reach with no question. Only
its words on the page change; the stored values do not.

This is the mechanism behind the next thing the product needs: a conversation
that says "download that model into Downloads" should get a one-line question
naming the folder, not a refusal. The rework is what makes that a small change.

### A project-less conversation gets one tree and no identity

A conversation with no project stands in its own `workspace/` under the
conversations directory, with the `scratch/`, `attachments/` and `artifacts/`
siblings every conversation gets, and nothing else: no container identity
minted or shared for it (the `profileAnchor` that anchored one to the
conversations directory goes with the container), and no grants written on
its behalf beyond the machine-wide scope rows it reads. A project
conversation stands in the project folder with the same three siblings.
Writing anywhere else is the scope question above. An earlier draft of this
section said "one folder"; the pair of `workspace/` and `scratch/` is kept
because it is what lets the model be told the same rule in both kinds of
conversation - the work goes in the workspace, everything else beside it -
and it never depended on the container.

### The seam stays

`hostIsolation` and the `IsolationBackend` interface stay, with `registry.ts`
holding the Linux backend and nothing for Windows or macOS. ADR 0041's
distinction between "does this build have a backend for this platform" and
"does it work on this machine" is still the right one and is still how a
backend is chosen. A Windows or macOS fence, or a WSL backend, is a new
registration behind the same seam and a new ADR.

## Consequences

**What is given up, stated plainly.** If the model runs a command the person
approved — `pip install x`, a build script — that process runs as the person,
with the person's files in reach. That is the position of every Windows user
of every harness today. The gate still asks before every such command; what is
gone is the second fence behind an approval that has already been given.

**What is not touched.** `CallGate`, the effects table, the approval contract,
grant durations, the destination rules, the credential store, undo snapshots,
trust per folder, the admission model, the MCP server launch path's decision
function. `architecture.test.ts`'s closed list of `runProcess` callers stays,
because the reason for it (a new execute-capable tool reaching for the familiar
function) did not depend on the container.

**What becomes simpler.** About 4,000 lines and one native binary leave the
tree. `pnpm sandbox:*` disappears from the install requirements. Bash is the
shell on Windows, so the model's first call is a real command. A project-less
conversation starts in the time it takes to make a folder. The settings pane
loses the toolchain presets and the elevation flow.

**What the tests must say.** Every test whose property was "a command cannot
write outside its scope" is rewritten to "the gate refuses a write outside its
scope" (rules.md §8), because that is the property that now holds and the one
that must not regress. `sandbox-appcontainer.test.ts` is deleted with the
backend it measured. `sandbox-bwrap.test.ts` stays and gains the gate-only
fallback case.

**Docs.** `git-sandbox-findings.md`, `git-sandbox-research-handover.md`, and
the sandbox section of `install-requirements.md` move to `archive/`. They are
correct about what they measured, and they measured something that no longer
ships.

**Order of work**, so that the suite is green at every step: (1) this ADR;
(2) the seam answers "none" on Windows and macOS with nothing deleted;
(3) delete the Windows backend, presets, ledger and CLI, rewrite the moved
tests; (4) the shell; (5) the modes and their UI; (6) the project-less
conversation folder; (7) the Linux opt-in and fallback; (8) archive the docs.
