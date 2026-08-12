# ADR 0018 — Workspace Trust And Execution Modes

**Status:** accepted
**Closes:** `T-03`, `T-09`. **Unblocks:** `shell`.
**Builds on:** ADR 0012 (permission kernel), ADR 0016 (undo).
**Amended by:** ADR 0025 — the rule below is unchanged, its key is now
`provenance.author`. The guarantee that Full Auto still prompts before a
connected server runs code depends on that `ask` being reached in
`BASE_POLICY` and not in `defaultVerdict`, which ADR 0025 makes explicit.

## Context

The kernel prompted for every `ask`, so there was no mode in which work
proceeded unattended — and no answer to the question that comes *before* any
per-call question: **is this folder one we should be acting in at all?**

Those are two different problems and they need two different mechanisms.

## Decision one: trust is about the folder, and it is answered once

Opening a repository someone sent you is the ordinary way a machine ends up
following instructions its owner never wrote — through a project config, a git
hook, a build script, or a file whose contents the model reads as direction.

Per-call permission does not address this, because the per-call question is
about a *capability* and the real question is about the *folder*. So trust is
its own precondition, stored per folder in `workspace_trust`.

**Untrusted folders are denied, not asked.** This is the load-bearing part. A
model that keeps trying can collect authority one click at a time; deciding
once, deliberately, about the folder is exactly what prevents that. A trust
prompt that appears per call is not a trust prompt, it is attrition.

**Reading is still allowed.** A harness that refuses to open a folder until it
is trusted cannot help anyone decide whether to trust it, and "let me look at
this repository first" is the normal reason the question is being asked.
Writing, running, and the network are refused, because those are what turn
someone else's repository into an instruction our machine follows.

**Trust outranks grants.** It is evaluated ahead of both policy and grants, so
distrusting a folder immediately voids approvals collected while it was
trusted. A grant that outlived the user changing their mind would make the
decision cosmetic.

**"Declined" is stored, not deleted.** The absence of a row means "never
asked", which is a different state from "asked and refused". Re-prompting
someone who already said no is how a dialog teaches people to click through it.

Paths are keyed case-insensitively on Windows, or the same folder could be
trusted under one spelling and untrusted under another.

## Decision two: a mode resolves the default `ask`, and nothing else

| Mode | What it does |
|---|---|
| **Manual** | Ask before anything that is not a plain read. |
| **Auto Edit** | Edit files without asking. Ask before running code. |
| **Full Auto** | Work without asking, except where a rule says otherwise. |

**A mode may only resolve an `ask` that came from the *default*.** An `ask`
from a policy rule is never touched.

That is the invariant the whole design rests on. `BASE_POLICY` forces an `ask`
before a connected server runs code; if a mode could resolve that, every rule
in the policy would become advisory and "the user cannot grant their way past a
rule" would stop being true. **Full Auto still prompts before an MCP server
executes.** There is a test named for exactly this.

**Auto Edit is bounded by effect, not by provenance.** A connected server's
*write* tool is resolved like any other write. Provenance is already handled,
once, in the policy — checking it again in the mode resolver would encode one
concern in two places, and the copy is always what drifts.

**Full Auto requires a working undo.** `requiresUndo(mode)` feeds
`TurnSnapshots.required`, which is now a function rather than a boolean so it
follows a mode change mid-session instead of a value captured at construction.
While a person approves each write, a snapshot failure is reported and the
write proceeds — undo is a safety net. Under Full Auto nobody is approving
anything, "you can undo it" *is* the safety story, and a write with no snapshot
behind it is what that argument rules out. That closes `T-09`.

## The default when no posture is supplied

`UNGATED_POSTURE` — every folder trusted, every `ask` asked.

It is exported under that name rather than inlined, so a caller relying on it is
visible in review as having skipped a safeguard. It reproduces exactly what the
harness did before trust existed, which makes it right for a fixture and wrong
for the application. Wiring a real posture into the application is `T-12`.

Failing closed here instead was considered and rejected: an absent posture means
"trust is not configured", not "this folder is suspect", and a default that
makes a freshly built harness silently read-only produces a bug report about
writes not working rather than a prompt about trust.

## The UI this implies

Recorded here because it is a decision, not a rendering detail, and Phase 18 is
far enough away that it would otherwise be re-argued.

**An approval has no timer and no progress bar.** There is no deadline on
approval — `bounds.run` is called after `authorize` returns, so the execution
clock starts when the user says yes, and someone who deliberates for twenty
minutes still gets a full deadline to run in. A bar on a dialog would imply
something is happening; nothing is, and the honest rendering of waiting on a
person is stillness.

**A running call shows elapsed time, not progress.** We know time elapsed. We
do not know work done, and a bar that fills with time claims proportional
completion that is false for nearly every tool.

- 0–2s: nothing, so fast calls do not flicker
- 2s to 75% of the deadline: elapsed time and a Stop control
- last 25%: a countdown bar, which is honest because it counts down to a real
  event we control

**Queued is shown separately from running.** `CallGate.inFlight` reports both.
"Waiting for a slot" and "running slowly" are different problems.

## Consequences

- `shell` is unblocked. Both of its prerequisites are now in place.
- Schema version 4.
- Trust state is listable, which the settings surface needs.
- A user in Full Auto on a machine without git gets refused writes rather than
  unreversible ones. That is the intended trade and it makes `V-01` — verifying
  an on-demand git download — matter more.
