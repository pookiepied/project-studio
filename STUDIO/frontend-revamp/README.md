# Frontend Revamp — task documentation

This folder is the single home for **all documentation related to the STUDIO frontend revamp**.
We treat this revamp as one task; every doc for it lives here (not in the repo root, not scattered
across `STUDIO/`). These are internal working docs that preserve project context, structured so **any
engineer or LLM can join at any point and continue correctly without prior conversation history.**

> "STUDIO" = the frontend. This folder is `STUDIO/frontend-revamp/`.

## ▶ Start here

**Read [`00-INTENT.md`](00-INTENT.md) first, every session.** It is the project constitution — the
philosophy, ground rules, the mandatory per-phase workflow, the verification process, and phase
completion criteria. It also contains the **cold-start procedure** (§7) for joining the project fresh.

Then follow the order: **00-INTENT → 01-AUDIT → the target phase in 02-PLAN → 03 + 04 (prior context)
→ the codebase → implement → verify → document → mark complete.**

## Index

| File | What it is | When we update it |
|---|---|---|
| **[00-INTENT.md](00-INTENT.md)** | **The constitution / source of truth**: philosophy, ground rules, mandatory workflow, the verification process, completion criteria, onboarding. | When the **process/rules** change (deliberate, rare). |
| **[01-AUDIT.md](01-AUDIT.md)** | The original audit + the finalized design philosophy & semantic token system. The *evidence/reference library* — "what's wrong and why." | When we discover a new **deficiency/issue** in the codebase, or refine the design system. |
| **[02-PLAN.md](02-PLAN.md)** | The execution plan + live progress tracker — phases, tasks, dependencies, acceptance criteria, dashboard. The **plan of record**. | **After every completed task** (tick the box, update the dashboard). |
| **[03-DECISIONS-AND-CAVEATS.md](03-DECISIONS-AND-CAVEATS.md)** | Implementation-level reasoning: decisions not obvious from code, exceptions, assumptions, deliberate "left untouched", deferrals, cross-phase dependencies, known out-of-scope bugs. | **Whenever something noteworthy happens** during implementation/verification. |
| **[04-PHASE-SUMMARIES.md](04-PHASE-SUMMARIES.md)** | One short overview per completed phase: what changed, decisions, trade-offs, clarifications, **and the verification results**. | **After every completed phase** (only once its verification has passed). |

## Working agreement (standing process for this task)

The authoritative version is **`00-INTENT.md` §4–§6**. In short:

1. **Read before you build.** Follow the `00-INTENT.md` §4 order (intent → audit → phase → prior docs
   → codebase) before implementing.
2. **Update the plan after every task.** The *first* thing on finishing a task is to flip its checkbox
   in `02-PLAN.md` and update the §9 dashboard.
3. **Verify after every phase (mandatory).** Run the dedicated verification pass (`00-INTENT.md` §5)
   against the **actual codebase**, fix anything it finds, then record the result in the phase summary.
4. **Summarize after every phase.** Add a concise entry to `04-PHASE-SUMMARIES.md` (what changed,
   decisions, trade-offs, clarifications, verification results).
5. **Capture context as it happens — don't rely on memory.** Log to `03-DECISIONS-AND-CAVEATS.md`
   anything future-us would want to know.
6. **A phase is complete only when** implementation **and** verification pass and the docs reflect
   reality (`00-INTENT.md` §6).

### Where does a given note go?

- **Project philosophy / process / workflow rule** → `00-INTENT.md`.
- **A codebase deficiency / design-system gap we discovered** → `01-AUDIT.md`.
- **A locked high-level design or architecture decision** → `02-PLAN.md` §8 (Decisions log).
- **An implementation caveat, assumption, deferral, "left untouched", cross-phase dependency, or a
  verification finding** → `03-DECISIONS-AND-CAVEATS.md`.
- **Per-phase "what happened" overview + verification results** → `04-PHASE-SUMMARIES.md`.
- **Task status / checklist** → `02-PLAN.md` (phase tasks + §9 dashboard).

When in doubt, prefer over-documenting in `03` — it's the catch-all for reasoning.
