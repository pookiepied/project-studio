# ADR 0020 — One Table Says What An Effect Requires

**Status:** accepted
**Amends:** ADR 0019 (which did not ask what reversibility means for a chosen program)
**Builds on:** ADR 0012 (permission and containment), ADR 0016 (undo), ADR 0018 (trust and modes)
**Closes:** `T-14`, `T-15`, `T-17`

## Context

A cross-reference audit over Phase 10 found eleven defects. Three of them were
the same defect wearing different clothes:

- `shell` declares `execute`, writes to the project anyway, and the gate took no
  snapshot — because the gate tested for `write` (`T-14`).
- `git` declares `read`/`write`, reaches the network anyway, and Auto Edit would
  have pushed without asking (`K-04`).
- A tool can be registered with Flue directly and skip the gate entirely
  (`T-19`).

The shape is one thing: **hand-written metadata was made load-bearing without
being made verifiable.**

Six files read `descriptor.effects`, and each held its own rule inline:

| File | Its private rule |
|---|---|
| `permissions/trust.ts` | every effect is `read` |
| `permissions/policy.ts` | every effect is `read` |
| `permissions/mode.ts` | every effect is `read` or `write` |
| `sandbox/local-sandbox.ts` | each effect maps to an isolation level |
| `tools/gate.ts` | effects include `write` |
| `contracts/capabilities.ts` | effects include `execute` or `network` |

Six copies of one idea, and nothing compared them. Five handled `shell`
correctly. The sixth did not, and the disagreement shipped.

The user's objection was the right one, and sharper than "this is complex": a
system where one thing follows the pattern and another does not is a system
nobody can predict. The undo history's value was never the keying — it was the
*uniformity*. One exception does not reduce that guarantee, it removes it,
because now you have to know which tools are covered.

## Decision

**One table. `src/contracts/effects.ts`. Every reader looks it up.**

| Effect | isolation | undo | elevated | safeUntrusted |
|---|---|---|---|---|
| `read` | in-process | no | no | **yes** |
| `write` | in-process | **yes** | no | no |
| `execute` | **os** | **yes** | **yes** | no |
| `network` | **os** | no | **yes** | no |

Each reader becomes a lookup:

- **Snapshot** — any effect with `undo`
- **Untrusted folder** — every effect must be `safeUntrusted`
- **Auto Edit** — no effect may be `elevated`
- **Sandbox** — the highest `isolation` present

To add an effect you add a row and answer four columns. No other file changes,
and the compiler names every reader if the shape moves.

### Why `execute` needs a restore point

This is the correction ADR 0019 missed, and it follows from that ADR's own
reasoning rather than contradicting it.

ADR 0019 admitted `execute` because *we did not choose the program* — so
containment was the wrong frame and authorization was the right one. The same
sentence answers reversibility. If we did not choose the program, **we cannot
know what it touched.** "Unknown extent" and "unchosen program" are one fact,
and a point to return to is the only honest response to it.

Cost: one commit per turn that runs any program, including `node --version`.
Empty commits are already allowed by design (ADR 0016) and git delta-compresses
them to roughly a hundred bytes. Cheap enough not to argue about.

### Why `network` does not

A request leaves the machine. It does not change the project on the way out. A
snapshot is not the tool for what comes *back* — that is `C-10`, and it is a
question about untrusted input reaching the context window, not about files.

### A tool states its own deadline

`shell` clamped `timeoutMs` to ten minutes while `CallBounds` abandoned every
call at two, so the clamp promised time it could not give (`T-15`). Two bounds
disagreed because neither could see the other.

`ToolDefinition.deadlineMs` now travels with the tool and reaches `CallBounds`
at registration. Precedence is **operator, then tool, then shared default** — a
tool asking for more must not overrule a limit somebody set on purpose.
`CallGate.deadlineFor` exposes the answer, because the only way to see it before
was to reach inside `CallBounds`.

### The shadow repository serialises whole operations

A capture is `add`, then `commit`, then `rev-parse`. `index.lock` does not
protect that sequence — each command succeeds individually, and a second capture
starting between the `add` and the `commit` folds two states into one snapshot.

So `ShadowRepository.transaction` is the unit, not the command. It is not
re-entrant, which is why `restore` uses an unlocked internal capture: the undo
point must be taken inside the restore that depends on it.

The chain records completion rather than success. A rejected link would stop
every later capture, and a failed snapshot must not disable snapshots.

## What this does not fix

**`K-04` remains open.** `git` under-declares because effects are per capability
and `git push` is one subcommand. The table cannot see inside a call. Per-call
effects is a real decision with real cost, and folding it in here would have
made this change about two things. `tests/unit/effect-rules.test.ts` asserts the
wrong answer on purpose, so fixing git turns that test red and points at the
issue explaining why.

**`T-19` remains open.** The table makes declarations consistent. It does not
make them *true*, and nothing yet stops a tool skipping the gate. The answer is
an architecture test at Phase 11, when MCP makes a second registration path
real.

## Consequences

- The audit's own findings are now covered by tests that were confirmed failing
  against the old code first. A test that only passes on fixed code proves
  nothing.
- `IsolationLevel`, `requiredIsolation`, and `satisfiesIsolation` moved from
  `sandbox/policy.ts` into the table and are re-exported, so no import site
  changed.
- The table must stay small. Twenty columns would be the problem it replaced,
  wearing a different name.
