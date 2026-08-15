# Project Studio — project map

Orientation, not detail. This page tells you where things are; the things
themselves live one click away.

## What Project Studio is

A local-first environment for coding work driven by agents. It is built as
separate products that are designed to work together, not as one application.

| Product | What it is | Where |
|---|---|---|
| **Studio Harness** | The runtime. Agents, permissions, sandboxing, policy, execution, storage, MCP. Everything with authority. | `STUDIO HARNESS/` |
| **Studio Client** | The desktop application. Tauri shell over the Harness. | `STUDIO/` |
| **Studio Gateway** | Legacy hosted model gateway. **Paused.** Reference material only — a simpler Project Studio-owned gateway will replace it. | `STUDIO Gateway/` |

The Harness is the primary codebase. The Gateway must not be allowed to shape
the Harness's architecture; see `F-001`.

## Where everything lives

```
Project Studio/
│
├── documentation/          ← you are here. How the project is managed.
│   ├── PROJECT-MAP.md       This file.
│   ├── HOUSE-RULES.md       Constraints that fail work outright if broken.
│   │
│   ├── tree/                THE SYSTEM
│   │   ├── project-tree.md   Current shape and status of everything.
│   │   └── conventions.md    How work is recorded. Read once, first.
│   │
│   ├── phases/              What each stage was meant to deliver.
│   ├── tasks/               What was built.
│   ├── audits/              Whether it holds up.
│   ├── decisions/           Why it is this way.
│   ├── blockers/            What is stopping work.
│   ├── follow-ups/          What we postponed on purpose.
│   ├── architecture/        How the system is shaped.
│   └── archive/             Superseded. Kept for provenance, not for reading.
│
├── STUDIO HARNESS/         THE RUNTIME
│   ├── src/                 (map: architecture/directory-map.md)
│   ├── tests/
│   └── docs/
│       ├── STATUS.md         Current snapshot.
│       ├── KNOWN-ISSUES.md   Defect register.
│       ├── ROADMAP.md        Phases 1-18.
│       └── decisions/        ADRs 0001-0034. Harness-scoped.
│
├── STUDIO/                 THE DESKTOP CLIENT
└── STUDIO Gateway/         LEGACY. Paused. Do not extend.
```

## The path through, for a new session

1. `tree/conventions.md` — how work is recorded here.
2. `tree/project-tree.md` — what is done, what is not, what is blocked.
3. The node you are actually working on.

That is the whole of it. Everything else is opened when one of those three
names it.

## Where a new fact goes

| The fact is… | It goes in… |
|---|---|
| A stage of the product | `phases/<product>/` |
| Work to be done or done | `tasks/`, as `T-NNN` |
| A check on existing work | `audits/`, as `A-NNN` |
| A choice with alternatives | `decisions/`, as `D-NNN` (Harness-internal rules stay as ADRs in `STUDIO HARNESS/docs/decisions/`) |
| Something stopping progress | `blockers/`, as `B-NNN` |
| Something postponed | `follow-ups/`, as `F-NNN` |
| A defect in shipped Harness code | `STUDIO HARNESS/docs/KNOWN-ISSUES.md` |

If you are about to create a document that fits none of these, that is a signal
the structure is wrong — fix the structure rather than adding a seventh place
to look.

## Current state, in one paragraph

Phases 1–11 are implemented and under remediation; none is verified. A baseline
verification (`A-003`, 2026-08-15) ran the Harness suite to completion for the
first time and found 21 failures, including every Flue integration test: two
defects on `POST /agents/:name/:id` — a patch calling a function that does not
exist, and a sandbox probe throwing where a boolean was required — meant no
agent submission could succeed. Both are fixed (`T-002`); 6 failures remain.
The modular-monolith gate (`008.3`) is recorded as closed but is not, and its
architecture tests were written to assert the violations rather than their
absence (`A-002`). Work is sequenced in `tree/project-tree.md`.
