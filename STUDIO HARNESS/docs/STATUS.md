# Where We Stand

A snapshot, not a plan. `ROADMAP.md` says what order to build in and
`KNOWN-ISSUES.md` says what is currently untrue about the system; this file
answers "how far along are we, and what is actually blocking what".

Refresh it at a phase boundary. The active ordered closure checklist is
`tasks/phase-11-mcp/008-phase-1-11-completion.md`; this file is only the snapshot.
If it disagrees with that task or the source/tests, it is stale.

Last refreshed: 2026-08-14 after the Phase 1-11 completion checklist was created.
The working tree remains dirty and current source is ahead of several historical
audit paragraphs.

Then a cross-reference audit over everything shipped, which is why this file now
contradicts itself less and admits more. It found eleven real defects — `T-14`
through `T-21`, `K-04`, `P-05`, `P-06` — and the two that matter are that
`shell` writes without an undo point and that `edit` silently corrupted any
replacement containing `$`. Nothing found was a regression; all of it was
shipped believing otherwise.

The audit remediation and current cleanup have fixed the listed MCP/native,
process, snapshot, shell, Git policy, and CLI error findings in source. The
remaining work is now ordered in Task 008 rather than treated as unrelated
patches.

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
| 1–4 | Harness foundation, agent loop, persistence, recovery | Existing - verify fail-safe matrix |
| 5 | Observability | Existing - verify correlation and failure behavior |
| 6 | Provider bootstrap | Harness-side existing - verify capability/stream matrix |
| 7 | Studio Gateway integration | **Partial - contract mismatch; decision required** |
| 7.5 | Architecture review | Done |
| 8 | Auth, credentials, local BYOK | Harness-side existing - verify OS/client lifecycle |
| 9 | Permission and containment kernel | **Partial - containment decision and API closure open** |
| 10 | Native agent tools | Native scope implemented - cross-platform/API verification open |
| 11 | MCP | **Partial - core integrated; runtime/platform/API proofs open** |
| 12 | Skills | Not started |
| 13 | Subagents and tasks | Not started |
| 14 | Projects, workspaces, sandboxes | UI precursor only; product persistence not started |
| 15 | Memory and context | Not started |
| 16 | Workflows and schedules | Not started |
| 17 | Evals | Not started |
| 18 | Product integration | API/Host source exists; packaging and E2E pending; UI work excluded from Task 008 |

The first eleven phases are not declared closed yet. Task 008 closes them in
order, including their accepted/deferred decisions and API boundaries, before
Phase 12 or later product work begins.

---

## What exists and works

**Model access.** Three sources behind one registry: the Studio Gateway
(curated, paid), local BYOK (36 built-in providers, 1,072 models, plus custom
OpenAI-compatible providers covering Ollama and LM Studio), and a deterministic
test adapter. The agent only ever names `project-studio/default`; the registry
resolves it. Keys live in the OS keychain, never a file.

**Persistence.** An application-owned SQLite database with versioned migrations,
separate from Flue's. A migration guard fails anything that looks like a
credential column — inside the migration's own transaction, so it rolls back,
and on every open, so a file poisoned by an older build cannot pass.

**Errors.** One contract. Every subsystem declares a domain and reports through
one path, so an unclassified throw is visible in telemetry rather than silent.

**Redaction.** One catalog, `src/observability/redaction-rules.ts`. Eleven named
rules; ten on, `email` off. Always applied to logs and errors, with no switch to
remove it. Rules turn on or off by id, in code or through
`PROJECT_STUDIO_REDACTION_RULES`.

It cleans the log copy only. The model and the tools always receive the real
text — deciding what the *model* may see is context policy and is a different
subsystem. See `check-later.md` C-12.

**What an effect means.** One table, `src/contracts/effects.ts`, answering four
questions for four effects: which isolation it needs, whether it needs a restore
point, whether it may ever be silent, and whether an untrusted folder allows it.
Six files used to hold their own copy of that and one of them disagreed. See
ADR 0020.

**Permissions.** A kernel that decides but never executes and never prompts.
Trust beats policy beats grants beats default. Decisions match on the
*resource*, so `git:log` and `git:push` are separate questions. Grants persist,
are revocable, and apply only in the project they were approved in (ADR 0021).
A capability that declares no effects is refused at registration, because an
empty effect list was the most permissive thing one could declare.

**Trust and modes.** Trust is per folder, decided once, and denies rather than
asks — reading an untrusted folder is allowed so it can be looked at; writing,
running, and the network are not. Manual / Auto Edit / Full Auto resolve a
*default* `ask` and never a policy one, so Full Auto still prompts before a
connected server runs code. Full Auto requires a working undo. See ADR 0018.

Auto Edit is bounded by declared effect, which means it is only as accurate as
the declarations. `git` declares `read`/`write` and reaches the network anyway,
so Auto Edit would push without asking — `K-04`. Not reachable today, because no
posture is wired and the mode is always `manual` (`T-12`); reachable in the same
change that fixes that.

**Tools.** Nine of ten, all behind one `CallGate` that authorizes before it
executes:

| Family | Tools | Notes |
|---|---|---|
| Filesystem | `read`, `write`, `edit` | Read-before-modify enforced, and reversible |
| Search | `glob`, `grep` | Over vendored ripgrep 14.1.1 |
| Version control | `git` | Complete subcommand coverage, one capability |
| Execution | `shell` | One program, one argument vector, no shell. Native only |
| Web | `web_search`, `fetch` | The resource is the destination host. See ADR 0022 |

**The web pair needs a key before it does anything.** `fetch` reads through
Jina Reader and `web_search` through Tavily by default, and each has one
optional fallback slot — never a pool. Which service fills a slot is settings;
no vendor name appears in either tool's schema. See ADR 0023 and `src/retrieval/`.

**None of them is reachable by the running agent yet.** `src/app.ts` builds no
gate, and `src/agents/studio.ts` registers exactly one tool —
`workspace_summary`, a fixture that echoes its input and goes around the gate
entirely (`T-19`). Everything in the table is built, tested, and unwired. The
wiring is `T-12`, and it has collected two other issues that become real in the
same change: `K-04` (git reaches the network without declaring it) and `T-19`
(the agent's only tool bypasses the gate).

**Both capability switches are on.** `allowExec` and `allowNetwork` default to
true, so all nine tools work out of the box. They were never the wall that
protects the user — containment is — and an agent that cannot run a command or
reach the network is a text box. The switches remain for a locked-down
deployment: per workspace, by `PROJECT_STUDIO_ALLOW_EXEC` /
`PROJECT_STUDIO_ALLOW_NETWORK`, or one line in `policy.ts` for a fork. A
capability that is switched off disappears from what the model is shown, so
nothing is advertised that cannot run. See ADR 0024.

**Containment is not one of them.** Every path in every tool already goes
through `resolveContainedPath`, which refuses anything outside the opened
folder — including `..`, symlinks pointing out, sibling folders whose names
share a prefix, and other drive letters. That wall holds today and has no
"approve anyway" option.

The former direct-tool bypass is now **fixed**: `workspace_summary` and all
native families register through `registerNativeTools()` and `CallGate`. The
architecture test has no known bypass exception, and the real Flue tests still
exercise the workspace fixture through the gate.

**Call bounds.** Every call has a deadline covering queue time and execution, a
signal that reaches the tool so cancellation works mid-call, and a FIFO
concurrency queue. An abandoned call tells the model whether repeating it is
safe, which is what `CapabilityDescriptor.idempotent` was declared for. See ADR
0017.

**Undo.** A shadow git repository per project in `~/.studio/data/snapshots/`,
work tree pointed at the project. The gate snapshots before each turn's first
write, keyed on the declared `write` effect. Scope is the project minus ignored
files, plus every path a write tool touched. Restore is itself snapshotted
first. See ADR 0016.

Since ADR 0020 the gate asks the effect table rather than testing for `write`,
so `execute` earns a restore point too. A program the model runs is a program we
did not choose, which means we cannot know what it touched — and that is the
same fact, not a second one.

It still cannot return two things, by construction: files git ignores that a
subprocess created, and the user's own git history (`T-20`). The UI must say so
— *undo returns your files, not your build and not your branch*.

**Where things live.** Three locations, decided once (ADR 0014): the
installation is read-only, `~/.studio` is ours and writable in six categories,
the project belongs to the user. Nothing resolves against the working directory
— including Flue's own journal, which used to default to `./data/flue.db` and
therefore landed in whichever project was open (`H-02`, fixed). A configured
relative path that climbs out of the home is refused rather than normalised
(`H-03`, fixed).

---

## What is left, and what blocks it

### Immediately next

**Task 001 is closed — all 20 items.** A second audit — five reviewers over all
21,274 lines — raised 22 complaints, 20 verified valid. Each one was recorded
with its evidence, its fix, and the number of tests that fail without it; every
item now lives below as its own Fixed entry.

Two of them let a model run any program on the machine through the `git` tool,
which declares `read`/`write` and therefore needs no execution permission. Both
were proven against real git, and both are fixed (`T-23`, `T-24`).

Every fix was verified the same way: write the test, revert the fix, confirm the
test fails, restore. One item — 19 — turned out to be the audit being wrong, and
is recorded as such rather than changed to match.

**The audit findings came before `fetch`** on purpose. Adding the last tool on
top of known holes is building on a floor we know has one.

~~**`T-16`** — `edit` corrupting `$` in a replacement.~~ Fixed.

~~**`T-14`, `T-15`, `T-17`** — `shell` writing with no undo point, its
unreachable ten-minute ceiling, and the missing shadow-repo lock.~~ Fixed —
ADR 0020.

~~**`fetch`** is next, and `C-10` is the question it waits on.~~ Done — ADRs
0022 and 0023. `C-10` is closed.

**Phase 11 (MCP) is in progress — the protocol and P1/P2 remediation are
implemented in the dirty tree, but the packaged Host boundary is not closed.**
The current work is tracked in tasks 006 and 007. Admission, recursive secret
validation, lifecycle/catalog recovery, append-only tool membership, native gate
wiring, result/name semantics, credential cleanup, approval cancellation, and
Gateway fail-closed tests are now source-backed.

Research and design are in `tasks/phase-11-mcp/002-design.md`; task 005 records
loose ends, task 006 records local admission, and task 007 records the audit
remediation. The registry, extend spine, wire layer, both channels, handshake,
supervisor, reconciler, catalog, CallGate, management routes, approval routes,
and real Flue/stdio paths now have callers in the dirty tree.

**One process per launch, not per server** (`C-18`, closed). Two projects share
a process only when the command, the arguments, the environment, and the working
directory are identical; a remote server has no working directory, so two
projects reaching one endpoint share one connection. The launcher owns that key
because it is the only thing that varies it, and `McpServerRegistry.reachKey` is
the one spelling of "the fields that matter" — the same list that decides
whether an edit revokes a grant.

**A launcher now turns a stored row into a live server.** It holds the two
things the supervisor must not: the project root that becomes a local server's
working directory, and the secret, read from the credential store at the moment
of the launch and never stored. It is also the only place a transport is chosen.
Writing it found `A-03` — the `mcp` credential scope had been in the type and
absent from the guard since the registry landed, so MCP sign-in could never have
worked.

**Both transports exist and the connection knows about neither.** A child
process and a Streamable HTTP endpoint go through one seam, and the framing, the
era probe, and the handshake are the same code over both. What HTTP could not
express through a duplex seam — a failed POST is the answer to what it carried,
and a remote server has no `stderr` — is ADR 0027.

**This was true when written and no longer is.** Every Phase 11 module had zero
callers in `src/` until the launcher (`L-04`) gave the supervisor a real one —
measured, not assumed, and kept here because the shape it describes was
deliberate: each piece tested against a fake, wiring last. What is still true is
the risk that shape carries: one class of bug cannot be found until the pieces
are assembled against something real. `S-04`
was exactly that shape and appeared the moment a real process was spawned.

Everything unfinished in the phase is listed in
`tasks/phase-11-mcp/005-loose-ends.md`, and **the phase is not finished while that
file has an open item.**

The protocol split into two eras on 2026-07-28: the modern revision has no
`initialize` handshake, no session id, and no server-initiated requests, and it
deprecates Roots, Sampling, and Logging outright. We speak modern by default and
probe for legacy.

**One finding blocked the phase, and is now decided.** A connected capability
declaring `execute` or `network` is refused absolutely (ADR 0019, ADR 0024), and
those two are the only honest declaration for a tool we did not write. The
dirty-tree MCP path now reaches the kernel and CallGate with that policy intact.

The answer is three layers, and it collapses rather than adds. **Installed** —
accepting once that this program runs outside the folder wall, recorded at the
moment the server is added. **Enabled** — which servers *this project* uses,
defaulting to off, checked before anything is spawned or probed. **Approved** —
the permission kernel, untouched. Enabling never approves a call. Under ADR
0029, disabling makes retained session tools unavailable at dispatch and a new
sandbox omits them. This mirrors ADR 0021 — trust is global, selection belongs
to a project — and the same three layers cover future skills and connectors.

Four smaller collisions are in §3 of the task file. `npx` is resolved to an
interpreter plus an absolute script path rather than refused, which keeps
`shell: false` and never reaches `cmd.exe`, so CVE-2024-27980 stays closed.

The destination guard splits by **who wrote the URL**, not by what the address
is (`C-17`). A URL the user typed into a settings form needs only to be
well-formed. A URL the model chose keeps a strict guard, but "private" was too
coarse: cloud metadata is refused and never offered, LAN ranges are refused by
default, and loopback goes through the normal approval ladder — with host *and
port* as the resource, so approving a dev server does not approve an unsecured
Ollama on the next port.

**A third author appeared once the client was built** (`src/net/http.ts`, ADR
0026): the server on the other end, which writes an address every time it
answers with a redirect. Every hop after the first is judged as though a model
chose it, whoever the caller was, and credentials do not cross an origin. The
client also pins — resolve once, judge **every** address returned, connect to
the address that was judged — because a check and a socket that resolve a name
separately can get two different answers, which is the whole of DNS rebinding.
It is now the only place the harness opens an outbound connection itself.

**The shared part of `src/extend/` is a spine, not an engine.** Two files —
identity and origin, per-project on/off — that MCP, skills, and hooks depend on
and that knows none of them. One architecture rule enforces the direction, so a
fourth kind adds a folder and edits nothing. It decides presence, never
permission, and is off the call path entirely, so `CallGate` is still the only
door. There are three runtime kinds: a connector is a remote MCP server with a
good icon, and a plugin is a bundle that does not exist at runtime.

**Extensions we ship ourselves** live in `<installation>/library/`, a read-only
sibling of `vendor/` under ADR 0014. They count as native provenance, so the
bundled list is compiled in and hash-checked rather than scanned from a
directory — otherwise dropping a folder into `library/` would mint a trusted MCP
server. Their ids use a reserved `studio.` prefix that user ids may not take.

**Both protocol eras ship together.** Modern-only would connect to almost
nothing that exists today.

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
  tier; a remote MicroVM comes later. The current behavior/decision must be
  reconciled by Task 008 before external execute/network is called contained.
- **On-demand git install.** Needs hash verification first (V-01) — fetching an
  executable and running it unverified is the one thing that must not ship.
- **Non-text models.** Image, video, speech, and transcription are `unsupported`
  in the local catalog. Not a config gap; Pi's image collection is unwired.
- **Frontend seam.** API/Host/client source seams exist, but product UI wiring,
  packaged sidecar, cargo verification, and desktop E2E are Task 008 gates.

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
