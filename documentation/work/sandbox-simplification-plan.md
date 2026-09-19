# Sandbox simplification — the plan

**Status:** In progress — steps 1 to 5 done (ADR, seam, deletion, shell, modes); next is step 6, the project-less conversation folder. Step 1 is [ADR 0057](../decisions/0057-the-gate-is-the-boundary.md) · **Opened:** 2026-09-19 · **Last worked:** 2026-09-19
**Decision:** ADR 0057, which supersedes the Windows half of
[ADR 0041](../decisions/0041-containment-is-the-kernel-s-job.md) and
[ADR 0047](../decisions/0047-a-contained-command-can-find-the-programs-it-may-run.md),
and narrows [ADR 0018](../decisions/0018-trust-and-modes.md) to two modes.
**Evidence:** the `sandbox-scope.test.ts` failure diagnosed on 2026-09-19,
recorded in §2 below.

This document exists so the reasoning survives a context reset. It states
what was found, what was decided in conversation, and the order of work.
Nothing in it has been built.

---

## 1. The decision, in one paragraph

Delete the Windows AppContainer containment and everything that exists to
manage it. The permission gate (`CallGate.call`, ADR 0012, 0015, 0020) is
the security boundary on Windows and macOS, as it is in every other harness
on those platforms. Keep the `hostIsolation` seam and the Linux `bwrap`
backend as an opt-in, because that primitive is a fence around a process
and costs nothing to keep. Collapse execution modes to two. Run the user's
real shell with the user's real `PATH`. A project-less conversation gets one
scratch folder and nothing else.

## 2. Why — what was measured on 2026-09-19

The pre-existing failure in `tests/integration/sandbox-scope.test.ts`
("contained git reads the user's global config") is git inside the
container answering `fatal: unable to get current working directory:
Permission denied`. The cause, traced through
`src/sandbox/isolation/windows/traversal.ts`:

- The workspace sat under `C:\Users\pooki\AppData\Local\Temp`. Of its
  ancestors, `AppData` and `AppData\Local` landed in **no bucket** of
  `ensureTraversable` — not granted, not machine-held, not refused, not
  needs-elevation. `grantCorridor` threw, and the catch at about line 275
  accepted the weaker machine-wide traverse entry as satisfied, with a
  comment admitting that floor is enough for every contained program
  *except git*. So git fails and nothing reports why.
- `grantCorridor` throws because the ACLs are full of the sandbox's own
  leftovers. Measured with `icacls`: `C:\Users\pooki\AppData` holds about
  **100** stale per-workspace AppContainer SID entries, `AppData\Local`
  about **1,360**. Windows caps an ACL near 1,800 entries. The code already
  contains `#advisePreparation`, whose job is to warn that "these
  directories are taking one traverse permission entry per workspace" —
  the design predicted its own failure.
- The commit before this session (`71bbec4d`) fixed a symptom of the same
  mechanism: every project-less conversation minted its own identity and
  re-granted every root, measured at about a hundred seconds before the
  first command. The anchoring change stopped the minting but not the
  accumulation.

The structural point: on Linux and macOS a sandbox is a fence around a
process, set at start, with no side effects. On Windows, AppContainer is a
Store-app packaging model; making it contain a developer's shell means
**writing ACL entries onto the real filesystem**, which then need a ledger
(`windows-profiles.json`), three in-process caches, an elevation flow
(`pnpm sandbox:prepare`), a maintenance command, and a preset per
toolchain naming where Python, Java, Rust, pnpm and Flutter live.
`src/sandbox` is about 4,800 lines; most of it is this. Two limits are
already stated as unfixable inside a container (`py` finds Python through
the registry; Flutter's Dart VM cannot run under AppContainer). Bash under
Git for Windows dies with `STATUS_DLL_INIT_FAILED` inside the container,
which is why the shell tool runs `cmd.exe`, which is why the model expects
a POSIX shell, gets `cmd`, and wastes a tool call learning that in every
conversation.

Where the industry stands, for calibration: Claude Code contains commands
with `bubblewrap` on Linux and Seatbelt on macOS and has **no** OS sandbox
on Windows. Codex CLI uses Seatbelt and Landlock/seccomp, and its Windows
containment is late, experimental, and built on the same restricted-token
family. Nobody has made Windows containment work well for developer tools.

What the gate already gives, independent of the container: one door for
every executable call; effects classified in one table; approvals scoped to
a `scopeId` the model can never author; network destinations derived by our
code with loopback, link-local, private ranges and metadata addresses
refused before the question; credentials in the OS store only. What the
container added on top: protection against a command the gate *already
approved* touching files outside its scope. Real, second-order, and the
protection every other Windows harness lives without.

## 3. What changes

| Area | Today | After |
|---|---|---|
| Windows containment | AppContainer, per-workspace SIDs, ACL grants | none; the gate is the boundary |
| `src/sandbox/isolation/windows/` | ~4,000 lines: appcontainer, launcher, traversal, ledger | deleted |
| `src/sandbox/presets.ts` toolchain roots | where Python/Java/Rust/pnpm/Flutter live | deleted; the machine's `PATH` answers |
| `pnpm sandbox:prepare`, `sandbox:release`, the ledger file | required maintenance | deleted |
| Linux `bwrap` backend | default when present | kept, opt-in, behind the same `hostIsolation` seam |
| `hostIsolation` on Windows/macOS | AppContainer / (none) | answers "no isolation"; the gate continues |
| Execution modes (ADR 0018) | three plus scope questions | two: **ask** (every effectful call asks unless a rule the user wrote allows it) and **auto** (every default ask proceeds; policy asks still ask) |
| Scope questions / grants (ADR 0015, 0021, 0038) | per-project rows, presets, elevation | allow rules only; no ACL side effects |
| Shell tool | `cmd.exe` because the container permits it | the user's shell: bash if Git for Windows is present, else PowerShell, else cmd; a setting to choose; the system prompt names it |
| Toolchain access | policy `PATH` rebuilt from the disk | inherited `PATH` |
| Project-less conversation | its own identity and grants | one scratch folder under the conversations directory |
| Workspace vs conversation | two mechanisms with sharing rules | a project conversation runs in the project folder; a project-less one in its scratch folder; the gate asks before writing anywhere else |

What does **not** change: `CallGate`, the effects table, the approval
contract, the destination rules, the credential store, undo snapshots, the
admission model. The rework is subtraction under the gate, not a new
permission concept — rules.md §5 still applies.

## 4. Order of work

1. **ADR first.** Write ADR 0057 superseding the Windows half of 0041 and
   0047 and narrowing 0018, with §2 above as its context. The earlier
   decisions get a "superseded by 0057" line, not a silent deletion.
2. **Seam.** Make `hostIsolation` answer "none" on Windows and macOS; keep
   the Linux backend; make the sandbox policy a no-op when isolation is
   none. The suite must stay green here — this step deletes nothing yet.
3. **Delete.** Remove `isolation/windows/`, the presets' toolchain roots,
   the ledger, the prepare/release CLI, and their tests. Rewrite the tests
   whose meaning moved (rules.md §8): the property "a command cannot write
   outside its scope" becomes "the gate refuses a write outside its scope".
4. **Shell.** Detect the shells present, pick the default in the order
   above, add the setting, state the shell in the environment block.
5. **Modes.** Collapse to ask/auto with allow rules; update the settings UI
   and the mode pill.
6. **Conversations.** One scratch folder per project-less conversation; drop
   per-conversation identities and grants.
7. **Docs.** Retire `git-sandbox-findings.md`, `git-sandbox-research-handover.md`
   and `install-requirements.md`'s sandbox section to `archive/`.

## 5. What is given up, stated plainly

If the model runs a command the person approved — `pip install x`, a build
script — that process runs as the person, with the person's files in reach.
That is the position of every Windows user of every harness today. The
seam stays so containment can return on any platform that offers a process
fence worth having.

## 6. Stopgap, if the old mechanism must limp before this lands

An elevated `pnpm sandbox:prepare` widens the machine-wide entry on
`AppData` and `AppData\Local`, and the stale SID entries can be removed
with `icacls /remove`. This buys weeks, not a fix; it is recorded so nobody
spends an afternoon rediscovering it.
