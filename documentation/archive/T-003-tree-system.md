> **Superseded — archived 2026-08-15.** Kept for provenance, not as current
> guidance. The live source of truth is
> `documentation/work/phases-1-11-remediation.md`.

# T-003 — Tree System infrastructure

**Parent:** Project Studio (management structure)
**Status:** Verified
**Opened:** 2026-08-15 · **Closed:** 2026-08-15

## What and why

The project had outgrown what could be held in memory or reconstructed from
commits. Phases, tasks, audits, decisions, blockers, and postponed work existed
across scattered files with no relationship between them — and the relationship
is the part that was being lost.

The requirement: everything has a place in a tree, and the tree shows where each
thing came from, what depends on it, and whether it is actually done.

## What was implemented

A six-kind node system under `documentation/` — phase, task, audit, decision,
blocker, follow-up — each with a permanent id and a named parent.

| Path | Holds |
|---|---|
| `tree/conventions.md` | The rules. Read once, first. |
| `tree/project-tree.md` | Current shape and status of everything. |
| `PROJECT-MAP.md` | Orientation — where things live. |
| `phases/`, `tasks/`, `audits/`, `decisions/`, `blockers/`, `follow-ups/` | The nodes. |
| `architecture/` | How the system is shaped. |
| `archive/` | Superseded, kept for provenance. |

Existing documents were moved rather than rewritten, with `git mv` so history
follows them. `tasks/` moved under `documentation/` so the project has one
documentation root. Task 008 is preserved verbatim — re-cutting it into nodes
would lose more provenance than it would gain.

The existing work was then reconstructed as a tree: phases P-01..P-11, audits
A-001..A-003, blockers B-001..B-003, follow-ups F-001..F-002, tasks
T-001..T-006.

## The rule that came out of the audits

Conventions rule 5 — *a test that passes while the defect is present is worse
than no test* — is written from `A-002`. Four architecture tests had been
written as `expect(offenders.length).toBeGreaterThan(0)`: green because the
violation was there, and destined to fail once it was fixed. Rule 4 (verified
requires proof) and rule 3 (implemented and verified are different states) come
from the same place.

## Verification

Structural, not executable. Every node named in `project-tree.md` exists; every
status is supported by a node; every cross-reference resolves. Statuses were set
from what `A-003` observed by running the suite, not from task 008 checkboxes.

## Notes

The system is meant to be reusable across projects — the node kinds, statuses,
and rules are not Studio-specific. Extracting it as a template is worth doing
once it has survived a few months of real use, not before.

## Links

- `tree/conventions.md`, `PROJECT-MAP.md`, `A-002`, `A-003`.
