# Project Studio — project map

Orientation, not detail. Where things are; the things themselves are one click
away.

## What Project Studio is

A local-first environment for coding work driven by agents, built as separate
products designed to work together.

| Product | What it is | Where |
|---|---|---|
| **Studio Harness** | The runtime. Agents, permissions, sandboxing, policy, execution, storage, MCP. Everything with authority. | `STUDIO HARNESS/` |
| **Studio Client** | The Tauri desktop application over the Harness. | `STUDIO/` |

The Harness is the primary codebase. The retired Gateway does not shape its
architecture and never will again: the cloud was cancelled — the Worker in
`bd4d389`, the Harness's client for it in `45233d55` (2026-08-24) — and local
BYOK over Pi (ADR 0009) is the operational model source. The provider contract
still reserves the name "gateway" for a possible future *user-hosted* source.

## Where everything lives

```
Project Studio/                ONE git repository. No submodules.
│
├── documentation/             The only documentation root.
│   ├── README.md               The documentation system itself.
│   ├── project-map.md          This file.
│   ├── rules.md                Constraints that fail work outright.
│   ├── work/                   TEMPORARY. The active meta-task.
│   ├── architecture/           DURABLE. How the system is shaped.
│   ├── decisions/              DURABLE. ADRs; the index is the count.
│   ├── phases/                 DURABLE. What each phase delivered.
│   ├── audits/                 DURABLE. Read-only passes, dated.
│   └── archive/                Superseded, banner-marked.
│
├── STUDIO HARNESS/            THE RUNTIME. 250 tracked files. Primary codebase.
└── STUDIO/                    THE DESKTOP CLIENT. 129 tracked files.
```

Products are directories inside one repository, not separate repositories. Each
has its own `package.json` and `pnpm-workspace.yaml`, so they are independent
builds within one history — a normal monorepo. One branch, `main`; a commit can
span products.

## The path through, for a new session

1. `README.md` — how documentation works here.
2. `work/phases-1-11-remediation.md` — the single source of truth for current
   work. Every open issue, numbered and categorized.
3. `rules.md` — the constraints.

Everything else is reference, opened when one of those three names it.

## The current tree

Derived view — every fact here lives in a source document first. Statuses come
from what was observed by running the suite, not from checklists.

Work **branches**. Phases 1–11 did not each produce their own remediation;
together they produced one. That single trunk is where all current work happens,
and it may itself branch — a decision that turns out to need its own
investigation becomes a child of the issue that raised it, not a new top-level
task.

```mermaid
graph TD
    PS[Project Studio]:::root

    PS --> H[Studio Harness]:::prod
    PS --> C[Studio Client]:::ok

    H --> P111["Phases 1-11<br/>implemented, unverified"]:::warn
    H --> P1218["Phases 12-18<br/>not started"]:::idle

    P111 --> META["META-TASK<br/>Phases 1-11 remediation<br/>register holds the counts"]:::active

    META --> S0["Stage 0 — Decisions<br/>#12-#18 · #13 open"]:::ok
    S0 --> S1["Stage 1 — Correctness<br/>#25-#29"]:::ok
    S1 --> S2["Stage 2 — Architecture<br/>#19-#24"]:::ok
    S2 --> S3["Stage 3 — Dead code<br/>#30-#35"]:::ok
    S3 --> S4["Stage 4 — Repo + docs<br/>#36-#42 · #12 last"]:::ok
    S4 --> S4B["Stage 4b — OS isolation<br/>#15 + #32 + #41"]:::todo
    S4B --> S5["Stage 5 — Phase work<br/>#49-#62"]:::todo
    S5 --> S6[Stage 6 — Organization pass]:::todo
    S6 --> S7[Stage 7 — Fresh audit]:::todo
    S7 --> DONE["Phases 1-11 COMPLETE<br/>then 12-18 unlock"]:::goal

    DONE -.unlocks.-> P1218

    classDef root fill:#1e293b,stroke:#0f172a,color:#fff
    classDef prod fill:#7c3aed,stroke:#5b21b6,color:#fff
    classDef active fill:#0369a1,stroke:#075985,color:#fff
    classDef block fill:#b91c1c,stroke:#7f1d1d,color:#fff
    classDef todo fill:#334155,stroke:#1e293b,color:#fff
    classDef ok fill:#15803d,stroke:#166534,color:#fff
    classDef warn fill:#b45309,stroke:#78350f,color:#fff
    classDef idle fill:#475569,stroke:#334155,color:#cbd5e1
    classDef goal fill:#065f46,stroke:#064e3b,color:#fff
```

**Everything below Stage 0 is blocked on you.** The seven decisions are the only
thing standing between here and Stage 1.

### How a new branch appears

There is one rail. When something new is found, it does not become a parallel
task list — it becomes a numbered issue on the meta-task, in the stage its
dependencies put it in:

```
Stage N
   ↓
issue found  ─────►  new #N in the register, categorized
   ↓
needs a decision? ──►  Needs Decision, with options + recommendation
   ↓                      ↓
   └──────────────────  decision recorded as an ADR
                          ↓
                       Needs Implementation → Solved → verified → commit
```

A blocker is a **point on the rail**, not a detour off it. That is why there is
no `blockers/` folder.

## Current state, in one paragraph

Phases 1–11 are implemented and under remediation; none is verified. The two
defects that broke every agent submission are fixed and the suite is at 2
failures from 21. The modular-monolith gate was recorded closed but was
enforced by nothing — its tests asserted the violations rather than their
absence, and could not match a path on Windows at all; the storage half is now
closed and the tests bind. Seven decisions are open and block the rest. All of
it is enumerated in `work/phases-1-11-remediation.md`.

## Where a new fact goes

See `README.md` §9. Short version: anything we are currently doing goes in the
meta-task; anything durable goes in `architecture/`, `decisions/`, `phases/`, or
`rules.md`.
