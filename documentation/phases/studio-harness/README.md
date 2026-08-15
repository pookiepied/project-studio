# Studio Harness — phases

The eighteen-phase plan the Harness was built against. Phases 1–11 are
implemented and under remediation; 12–18 have not started.

**Nothing here is Verified.** See `../../audits/A-003-baseline-verification.md`:
when the suite was run to completion, every Flue integration test was failing.
A phase whose integration tests could not have passed is not verified, whatever
its checklist says.

| Phase | Title | Status | Notes |
|---|---|---|---|
| P-01..04 | Harness foundation | 🟢 Implemented | Agent loop, SQLite persistence, admission, restart recovery |
| P-05 | Observability foundation | 🟢 Implemented | OTel traces/metrics, redaction, structured logs |
| P-06 | Provider bootstrap | 🟢 Implemented | One lifecycle for model sources; `project-studio/default` |
| P-07 | Studio Gateway integration | 🔴 Blocked | `B-003` — Worker unsupported, contract undecided |
| P-08 | Auth, credentials, local BYOK | 🟢 Implemented | Keychain scopes; ADR 0007 |
| P-09 | Capability and permission kernel | 🟢 Implemented | `PermissionKernel`, `CallGate`, `LocalSandbox`; ADR 0012 |
| P-10 | Native agent tools | 🟢 Implemented | 10 capabilities across 6 families |
| P-11 | MCP | 🟡 In progress | Registry, transports, lifecycle; 165 open items in task 008 |
| P-12..18 | Skills → product integration | ⚪ Planned | Not started. Do not begin before the 1–11 gate closes |

## Where the detail is

The phase descriptions live in `STUDIO HARNESS/docs/ROADMAP.md` and are not
duplicated here. This folder holds what the tree needs: status, what came out of
each phase, and what is attached to it.

Phase 11 has its own source material in `phase-11-source-overview.md` and the
task files under `../../tasks/phase-11-mcp/`.

## What is attached to these phases

Findings from phases 1–11 do not belong to any single one of them — they came
from the interaction between all eleven. They hang off the audits instead:

```
P-01..P-11
     │
     ├── A-001  Phases 1-11 audit          → task 008, 181 items
     ├── A-002  Sanitary check 008.3-008.8 → the gate is not closed
     └── A-003  Baseline verification      → the suite was never run
```

See `../../tree/project-tree.md` for the whole shape.

## Phase 7.5

The roadmap records a "Phase 7.5: Architecture and Modularity Review" between 7
and 8. It is a review, not a delivery phase, and has no node — its successor is
`A-002`, which reviews the same ground and found the modular-monolith gate open.
