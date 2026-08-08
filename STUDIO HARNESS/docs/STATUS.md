# Where We Stand

A snapshot, not a plan. `ROADMAP.md` says what order to build in and
`KNOWN-ISSUES.md` says what is currently untrue about the system; this file
answers "how far along are we, and what is actually blocking what".

Refresh it at a phase boundary. If it disagrees with the other two documents,
they are right and this one is stale.

Last refreshed: Phase 10 in progress, 7 of 10 native tools shipped. Undo, call
bounds, trust/modes, and `shell` landed (ADRs 0016–0019). Only `fetch` remains
before Phase 11.

---

## The destination

A local-first agent harness that runs on the user's own machine, with the Studio
desktop application as its face. Three properties define "done", and every phase
below serves one of them:

1. **The agent can do real work on real projects** — read, change, search, and
   version files, run commands, reach the network, and call out to tools we did
   not write.
2. **Nothing happens that the user did not permit** — one permission kernel, one
   door, argument-level decisions, and containment for code we did not write.
3. **It survives being closed** — conversations, grants, and settings outlive
   the process, and a restart resumes rather than restarts.

The product surface is Studio V2 (React + Tauri). The harness is a separate
process it talks to; neither contains the other.

---

## Progress at a glance

| Phase | What it is | Status |
|---|---|---|
| 1–4 | Harness foundation, agent loop, persistence, recovery | Done |
| 5 | Observability | Done |
| 6 | Provider bootstrap | Done |
| 7 | Studio Gateway integration | Done |
| 7.5 | Architecture review | Done |
| 8 | Auth, credentials, local BYOK | Done |
| 9 | Permission and containment kernel | Foundation done, 2 items open |
| 10 | Native agent tools | **In progress — 7 of 10** |
| 11 | MCP | Not started |
| 12 | Skills | Not started |
| 13 | Subagents and tasks | Not started |
| 14 | Projects, workspaces, sandboxes | Not started |
| 15 | Memory and context | Not started |
| 16 | Workflows and schedules | Not started |
| 17 | Evals | Not started |
| 18 | Product integration | Not started |

Nine phases closed, one in progress, eight untouched. That is not 50% of the
work — the closed phases are foundation, and the open ones include everything
the user actually sees.

---

## What exists and works

**Model access.** Three sources behind one registry: the Studio Gateway
(curated, paid), local BYOK (35 built-in providers, 1,072 models, plus custom
OpenAI-compatible providers covering Ollama and LM Studio), and a deterministic
test adapter. The agent only ever names `project-studio/default`; the registry
resolves it. Keys live in the OS keychain, never a file.

**Persistence.** An application-owned SQLite database with versioned migrations,
separate from Flue's. A migration guard fails anything that looks like a
credential column.

**Errors.** One contract. Every subsystem declares a domain and reports through
one path, so an unclassified throw is visible in telemetry rather than silent.

**Permissions.** A kernel that decides but never executes and never prompts.
Trust beats policy beats grants beats default. Decisions match on the
*resource*, so `git:log` and `git:push` are separate questions. Grants persist
and are revocable.

**Trust and modes.** Trust is per folder, decided once, and denies rather than
asks — reading an untrusted folder is allowed so it can be looked at; writing,
running, and the network are not. Manual / Auto Edit / Full Auto resolve a
*default* `ask` and never a policy one, so Full Auto still prompts before a
connected server runs code. Full Auto requires a working undo. See ADR 0018.

**Tools.** Seven of ten, all behind one `CallGate` that authorizes before it
executes:

| Family | Tools | Notes |
|---|---|---|
| Filesystem | `read`, `write`, `edit` | Read-before-modify enforced, and reversible |
| Search | `glob`, `grep` | Over vendored ripgrep 14.1.1 |
| Version control | `git` | Complete subcommand coverage, one capability |
| Execution | `shell` | One program, one argument vector, no shell. Native only |

**Call bounds.** Every call has a deadline covering queue time and execution, a
signal that reaches the tool so cancellation works mid-call, and a FIFO
concurrency queue. An abandoned call tells the model whether repeating it is
safe, which is what `CapabilityDescriptor.idempotent` was declared for. See ADR
0017.

**Undo.** A shadow git repository per project in `~/.studio/data/snapshots/`,
work tree pointed at the project. The gate snapshots before each turn's first
write, keyed on the declared `write` effect — so a tool cannot be added that
writes without being reversible. Scope is the project minus ignored files, plus
every path a write tool touched. Restore is itself snapshotted first. See ADR
0016.

**Where things live.** Three locations, decided once (ADR 0014): the
installation is read-only, `~/.studio` is ours and writable in six categories,
the project belongs to the user. Nothing resolves against the working directory.

---

## What is left, and what blocks it

### Immediately next

~~**Snapshots (T-04).**~~ Done — ADR 0016.

~~**Gate bounds (T-02).**~~ Done — ADR 0017.

~~**Trust and modes (T-03, T-09).**~~ Done — ADR 0018.

~~**`shell`.**~~ Done — ADR 0019.

**`fetch`.** Needs an ADR on the network-effect question before any code —
SSRF is not containment, so the real question is what a network capability
means while isolation is `in-process`.

### The remaining three tools

| Tool | Blocked by |
|---|---|
| `fetch` | The network-effect question — SSRF is not containment |
| `task` | Phase 13 |
| `skill` | Phase 12 |

### Elsewhere

- **Isolation (S-02).** Only `in-process` exists. WSL2 is the intended local
  tier; a remote MicroVM comes later. Any capability needing `os` isolation is
  refused today.
- **On-demand git install.** Needs hash verification first (V-01) — fetching an
  executable and running it unverified is the one thing that must not ship.
- **Non-text models.** Image, video, speech, and transcription are `unsupported`
  in the local catalog. Not a config gap; Pi's image collection is unwired.
- **Frontend seam.** Nothing connects the harness to Studio V2 yet. Phase 18.

---

## Debts worth naming

**E-01.** Node 22.18.0 against a declared `>=22.19.0`, so every command warns
and `node:sqlite` is experimental here.

**H-01.** `logs/`, `sessions/`, `projects/`, `cache/`, and `tmp/` are named but
unused. The risk is not that they are empty; it is that an empty directory
invites a use it was not meant for.

---

## The rule that keeps this from drifting

One phase at a time, reviewed before the next begins, `pnpm check` green at
every checkpoint. When something new looks urgent, it goes in `ROADMAP.md` under
the phase it belongs to — not into the current one.
