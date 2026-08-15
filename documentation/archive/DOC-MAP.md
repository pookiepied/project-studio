> **Superseded — archived 2026-08-15.** Kept for provenance, not as current
> guidance. The live equivalents are `documentation/README.md`,
> `documentation/PROJECT-MAP.md`, and `documentation/tree/project-tree.md`.

# Doc map — where to look, and only there

One page. No prose to read first — the tree below is the whole thing. If a
fact could live in two places, it lives in the one node below and nowhere
else; every other file links to it instead of repeating it.

```
Project Studio/
|
|-- README.md                          What this repo is, one paragraph.
|
|-- documentation/                     REPO-WIDE. Rules and shape that apply
|   |                                  to STUDIO and STUDIO HARNESS both.
|   |-- mental-model.md                 Read once, first. What STUDIO is,
|   |                                    what it is not, the three ties it
|   |                                    breaks.
|   |-- architecture.md                 The directory map. What owns what,
|   |                                    where a new thing goes.
|   |-- check-later.md                  Open design questions, `C-NN`, each
|   |                                    with Open / Answered / Closed.
|   |-- PHASE-11-OVERVIEW.md            The readable account of Phase 11.
|   |                                    Open this to understand; open
|   |                                    phase-11-mcp/ below to work.
|   |-- DOC-MAP.md                      This file.
|
|-- tasks/                              WORK IN PROGRESS, organized by kind.
|   |-- README.md                       How this folder works - numbering,
|   |                                    when a file closes, this structure.
|   |-- META-INSTRUCTIONS.md            The operational checklist - what to
|   |                                    read, how "done" is proven, how an
|   |                                    issue gets routed.
|   |
|   |-- phase-11-mcp/                   THE LIVE PHASE. Its own progression,
|   |   |                                oldest to newest.
|   |   |-- 002-design.md                Design notes, written before any of
|   |   |                                 it was built. Reference only.
|   |   |-- 003-work-plan.md            THE CURRENT WORK. Running record of
|   |   |                                 what was built and why, newest
|   |   |                                 section last.
|   |   |-- 005-loose-ends.md           THE NEXT-ACTION LIST. What Phase 11
|   |                                    is still missing. Read this to know
|   |                                    what to do next.
|   |   |-- 006-harness-admission.md     The implementation plan for the global
|   |                                    Harness client boundary and Studio Host.
|   |   |-- 007-audit-remediation.md     P1/P2 MCP, permission, native, and Gateway fixes
|   |   |-- 008-phase-1-11-completion.md  The single ordered closure checklist for
|   |                                    Phases 1-11 and their API boundaries.
|   |
|   |-- delegation/                     THE DELEGATION PROCESS, not tied to
|       |                                any one phase.
|       |-- HOUSE-RULES.md               Read before assigning or doing any
|                                         delegated work. Rules that fail the
|                                         work outright if broken. A finished
|                                         delegated task's own record lives in
|                                         git history and in KNOWN-ISSUES.md /
|                                         the phase's own files, not as a
|                                         standing file here.
|
|-- STUDIO HARNESS/                     THE RUNTIME. Your code lives here.
|   |-- src/                            (see architecture.md for the map)
|   |-- docs/
|       |-- STATUS.md                   THE SNAPSHOT. How far along, right
|       |                                now. If this disagrees with the
|       |                                phase-11-mcp files, they are right
|       |                                and this is stale.
|       |-- KNOWN-ISSUES.md             THE DEFECT LIST. `A-NN`/`T-NN`/etc,
|       |                                each Open / Fixed / Accepted /
|       |                                Contained.
|       |-- ROADMAP.md                  Phase order, 1 through N. Rarely
|       |                                needs a read mid-phase.
|       |-- decisions/*.md              WHY A RULE EXISTS. Numbered ADRs,
|                                        each states what it amends. Read
|                                        one only when a loose end or an
|                                        issue names it.
|
|-- STUDIO/                             THE DESKTOP UI. No project docs
|                                        beyond its own README.md.
|
|-- STUDIO Gateway/                      Independent Worker; current contract is
|                                        not the supported Harness backend. Gateway
|                                        strategy is tracked by Task 008.
|-- MCP/                                 One file inside has uncommitted,
|                                        untouched changes that are not
|                                        this work's. Leave it alone.
```

## The one path you actually need

For almost every session, four files, in this order, is the whole of it:

1. `tasks/delegation/HOUSE-RULES.md` — the constraints.
2. `tasks/phase-11-mcp/003-work-plan.md` — read only the newest section,
   what was just built.
3. `tasks/phase-11-mcp/005-loose-ends.md` — what to do next. This is the
   file that answers "what's left."
4. `STUDIO HARNESS/docs/STATUS.md` — the current one-paragraph snapshot, to
   sanity-check 2 and 3 against.

Everything else on the tree above is reference, opened only when one of
those four points at it by name — an ADR number, a `C-NN`, an `A-NN`. Do not
read the `decisions/` folder end to end. Do not read `check-later.md` end to
end. They are dictionaries, not chapters.

## Where a new fact goes (so the tree does not grow sideways)

| The fact is... | It goes in... |
|---|---|
| A defect in code that already shipped | `KNOWN-ISSUES.md`, next id in its letter series |
| A design question with no answer yet | `check-later.md`, next `C-NN` |
| A piece of Phase 11 known to be incomplete | `phase-11-mcp/005-loose-ends.md`, next `L-NN` |
| A decision that changes how a rule works | a new numbered ADR in `decisions/` |
| The current one-paragraph state of things | `STATUS.md` — updated last, after the source file above is already correct |

If you are about to create a new top-level `.md` file, stop. It almost
certainly belongs as a section or an entry in one of the five files in that
table, not as a sixth place someone has to remember to check.
