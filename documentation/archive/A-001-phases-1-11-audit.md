> **Superseded — archived 2026-08-15.** Kept for provenance, not as current
> guidance. The live source of truth is
> `documentation/work/phases-1-11-remediation.md`.

# A-001 — Phases 1-11 audit

**Parent:** Phases P-01..P-11, jointly
**Status:** In progress
**Opened:** 2026-08-12 · **Closed:** —

## What and why

The original audit of the first eleven phases, run after they were implemented.
It produced 36 numbered findings (`AUDIT-01`..`AUDIT-36`) plus the `KNOWN-ISSUES`
letter series, and concluded that the phases could not be treated as a stable
baseline.

Its output was consolidated into a single ordered completion checklist — **181
items** across `008.1`–`008.22`, of which 165 remain open.

## Where the detail lives

This node is a pointer, not a copy. The findings and the checklist are:

- `../tasks/phase-11-mcp/008-phase-1-11-completion.md` — the active checklist,
  the clash-resolution layer, the blocker register, and the finding-to-item
  disposition table.
- `../tasks/phase-11-mcp/005-loose-ends.md` — Phase 11 `L-NN` gaps.
- `../tasks/phase-11-mcp/006-harness-admission.md`, `007-audit-remediation.md` —
  historical evidence, superseded by 008 as the active list.
- `STUDIO HARNESS/docs/KNOWN-ISSUES.md` — the defect register.

Task 008 is preserved as written. It is long, and its numbering was reordered
once already; re-cutting it into per-finding nodes would lose more provenance
than it would gain. New work derived from it becomes a `T-NNN` node whose parent
is this audit.

## Standing caveat

Task 008's status column records several items **Done** that later checks did
not support — see `A-002` (marked Done by exception, and by inverted tests) and
`A-003` (marked Done against a build in which the tested path could not
succeed).

**Do not read a checked box in task 008 as verified.** Reconciling those claims
is `T-006`.

## Children

- `A-002` — sanitary check of `008.3`–`008.8`.
- `A-003` — baseline verification.

## Links

- `B-001`, `B-002`, `B-003` — blockers raised here.
- `tree/project-tree.md`.
