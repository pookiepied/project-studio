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
| **Studio Gateway** | Legacy hosted model gateway. **Paused.** Removal pending decision #14. | `STUDIO Gateway/` |

The Harness is the primary codebase, and the Gateway must not shape its
architecture.

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
│   ├── decisions/              DURABLE. ADRs 0001-0034.
│   ├── phases/                 DURABLE. What each phase delivered.
│   └── archive/                Superseded, banner-marked.
│
├── STUDIO HARNESS/            THE RUNTIME. 278 files. Primary codebase.
├── STUDIO/                    THE DESKTOP CLIENT. 129 files.
└── STUDIO Gateway/            LEGACY. Paused.
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

    P111 --> META["META-TASK<br/>Phases 1-11 remediation<br/>62 issues"]:::active

    META --> S0["Stage 0 — Decisions<br/>#12-#18 · 7 open"]:::block
    S0 --> S1["Stage 1 — Correctness<br/>#25-#29"]:::todo
    S1 --> S2["Stage 2 — Architecture<br/>#19-#24"]:::todo
    S2 --> S3["Stage 3 — Dead code<br/>#30-#35"]:::todo
    S3 --> S4["Stage 4 — Repo + docs<br/>#36-#42"]:::todo
    S4 --> S5["Stage 5 — Phase work<br/>#49-#62 · 90 items"]:::todo
    S5 --> S6[Stage 6 — Organization pass]:::todo
    S6 --> S7[Stage 7 — Fresh audit]:::todo
    S7 --> DONE["Phases 1-11 COMPLETE<br/>then 12-18 unlock"]:::goal

    DONE -.unlocks.-> P1218

    SOLVED["11 Solved<br/>#1-#11"]:::ok
    UNK["3 Unable to Determine<br/>#43-#45"]:::warn
    META --- SOLVED
    META --- UNK

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
