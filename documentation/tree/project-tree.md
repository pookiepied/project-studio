# Project tree

The current shape of Project Studio. Derived view — every fact here lives in a
node first. Update this last, and always.

**Last updated:** 2026-08-15 · **Baseline commit:** `edba5a5`

Legend: ✅ verified · 🟢 implemented, unverified · 🟡 in progress · 🔴 blocked ·
⚪ planned · 📦 deferred

```
Project Studio
│
├── Studio Harness ................................... 🟡  the runtime
│   │
│   ├── P-01..04  Harness foundation ................. 🟢
│   ├── P-05      Observability foundation ........... 🟢
│   ├── P-06      Provider bootstrap ................. 🟢
│   ├── P-07      Studio Gateway integration ......... 🔴  B-003
│   ├── P-08      Auth, credentials, local BYOK ...... 🟢
│   ├── P-09      Capability & permission kernel ..... 🟢
│   ├── P-10      Native agent tools ................. 🟢
│   ├── P-11      MCP ................................ 🟡
│   │
│   ├── P-12..18  Skills → product integration ....... ⚪  not started
│   │
│   └── (from P-01..11 together)
│       │
│       ├── A-001  Phases 1-11 audit ................. 🟡  → task 008
│       │            36 AUDIT findings, 181 checklist items
│       │
│       ├── A-002  Sanitary check of 008.3-008.8 ..... ✅  findings stand
│       │            gate half-closed; tests inverted
│       │
│       └── A-003  Baseline verification ............. ✅  2026-08-15
│             │      first full suite actually run
│             │      21 failures → 2
│             │
│             ├── T-001  Git baseline & snapshot ..... ✅  95c99f6
│             ├── T-002  Admission path repair ....... ✅  655bf58
│             ├── T-003  Tree System infrastructure .. ✅  397b624
│             ├── T-004  Architecture gate (008.3) ... 🟡  edba5a5, partial
│             ├── T-005  Dead code & typing sweep .... ⚪
│             └── T-006  Doc reconciliation .......... ⚪
│
└── Studio Client (STUDIO) .......................... 🟢  desktop shell
        no phase plan of its own yet; tracked when one exists
```

## Blockers and follow-ups attached to the above

```
B-001  Flue initial-admission idempotency ............ 🔴  P-11 / A-003
B-002  Windows Host runtime verification ............. 🔴  P-01..04
B-003  Gateway contract undecided .................... 🔴  P-07
F-001  Legacy Gateway retirement ..................... 📦
F-002  Open design questions (C-NN register) ......... 📦
```

## What the statuses are actually claiming

The harness phases sit at 🟢 **implemented, unverified** rather than ✅ because
of what A-003 found: the full test suite had not been run to completion in this
environment, and when it was, 21 tests failed — including every Flue
integration test, on the single hottest path in the system. Two defects
(T-002), both on `POST /agents/:name/:id`, accounted for 15 of them.

A phase whose integration tests could not have passed is not verified,
regardless of what its checklist says. Promoting these to ✅ is what T-004
through T-006 are for.

P-11 is 🟡 rather than 🟢 because task 008 tracks 165 open items against it.

## Where the Harness suite stands

`CI=true vitest run` — **2 failed, 1125 passed, 2 skipped**, typecheck and build
clean. Both failures are pre-existing and tracked in `T-004`: `A-003` AF-03
(corrupt `studio.db` does not abort startup when a stale WAL is present) and
AF-04 (real stdio MCP through the gate).

`T-004` is partial. The storage boundary is closed and the architecture tests
now bind on both platforms, but three items remain: `StudioRuntime` still
publishes ten repositories, transport and agents still take the concrete
runtime, and `app_setting` is still written by two domains. Each is pinned by a
whitelist that can only shrink, so none can quietly get worse.

## How this file gets updated

See `conventions.md` rule 8. Change the node, then change this. A status here
that no node supports is exactly the drift this system exists to prevent.
