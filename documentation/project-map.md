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

Derived view. Statuses come from what was observed by running the suite, not
from checklists.

Legend: ✅ verified · 🟢 implemented, unverified · 🟡 in progress · 🔴 blocked ·
⚪ planned

```
Project Studio
│
├── Studio Harness ................................... 🟡
│   ├── P-01..04  Harness foundation ................. 🟢
│   ├── P-05      Observability foundation ........... 🟢
│   ├── P-06      Provider bootstrap ................. 🟢
│   ├── P-07      Studio Gateway integration ......... 🔴  decision #13
│   ├── P-08      Auth, credentials, local BYOK ...... 🟢
│   ├── P-09      Capability & permission kernel ..... 🟢
│   ├── P-10      Native agent tools ................. 🟢
│   ├── P-11      MCP ................................ 🟡
│   ├── P-12..18  Skills → product integration ....... ⚪  not started
│   │
│   └── Phases 1-11 remediation (meta-task) .......... 🟡
│         11 Solved · 7 Needs Decision · 38 Needs
│         Implementation · 3 Unable to Determine ·
│         3 No Longer Relevant
│
└── Studio Client ................................... 🟢
      No phase plan of its own yet. Its current work
      belongs to Harness Host/client contract items.
```

No Harness phase is ✅. When the suite was first run to completion, 21 tests
failed — including every Flue integration test, because two defects on
`POST /agents/:name/:id` meant no agent submission could succeed. A phase whose
integration tests could not have passed is not verified, whatever its checklist
says.

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
