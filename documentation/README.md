# The Project Studio documentation system

This file defines where documentation lives, what each kind contains, and the
format every document follows. It is the only place those rules are written.

**One repository, one documentation root.** There is no second `docs/` folder
anywhere in the project. If you find one, it is a mistake and belongs here.

---

## 1. The structure

```
documentation/
│
├── README.md          This file. The system itself.
├── project-map.md     What the project is, where things live, current state.
├── rules.md           Rules that fail work outright if broken.
│
├── work/              TEMPORARY. The active meta-task. One at a time.
│
├── architecture/      DURABLE. How the system is shaped.
├── decisions/         DURABLE. ADRs — why a rule exists.
├── phases/            DURABLE. What each phase was meant to deliver.
│
└── archive/           Superseded. Kept for provenance, not for reading.
```

Five folders. Three root files. That is the whole system, and it is deliberately
smaller than the categories the work naturally falls into — see §7 for why the
obvious extra folders are not here.

## 2. Durable versus temporary

The single most important distinction:

| | Durable | Temporary |
|---|---|---|
| **Lives in** | `architecture/`, `decisions/`, `phases/`, `rules.md` | `work/` |
| **Contains** | What is true about the system | What we are doing about it |
| **Lifetime** | Outlives the work | Retired when the work closes |
| **Example** | "Secrets live in the OS keychain, and here is why" | "Issue 23: two domains write `app_setting`" |

Work in progress goes in `work/`. When it closes, its **durable residue** —
what was decided, what the architecture now is, what a phase actually
delivered — is written into the durable folders, and the work document moves to
`archive/`.

This is why there is no permanent `tasks/` folder. A task is temporary by
definition. What survives it is a decision, an architecture fact, or a phase
record.

## 3. `work/` — the meta-task

**One active meta-task at a time.** It is the single source of truth for what
is being done right now. If a piece of work is not in it, we are not doing it.

It contains, in this order:

1. **Scope** — what closing this covers, and what it explicitly does not.
2. **Issue register** — every known issue, numbered `#1`, `#2`, … and
   categorized (§4). Nothing is dropped for being hard.
3. **Decisions required** — every open choice, with a recommendation.
4. **Execution order** — the sequence, with dependencies stated.
5. **Verification** — what must pass before the meta-task can close.

Issues are numbered plainly (`#1`) and never renumbered. A resolved issue keeps
its number and changes category; it is never deleted.

> Plain numbers, not letter series, because the existing `KNOWN-ISSUES`
> register already uses `T-NN`, `A-NN`, `D-NN`, `P-NN` for defects, and an
> earlier attempt at this system reused those same letters for tasks, audits
> and decisions. Two `T-04`s meaning different things is exactly the ambiguity
> a register exists to prevent.

## 4. Issue categories

Every issue in the register carries exactly one:

| Category | Meaning |
|---|---|
| **Solved** | Fixed and verified. Names the commit and the proof. |
| **Decision Made** | Choice recorded, implementation may still be pending. Names the decision. |
| **Needs Decision** | Blocked on a choice. States the options and a recommendation. |
| **Needs Implementation** | Understood and agreed; work remains. |
| **Unable to Determine** | Investigated, not resolved. States what was tried and what is unknown. |
| **No Longer Relevant** | Superseded or obsolete. States why. |

**"Unable to Determine" is a real answer and must be used.** An issue that was
hit and set aside belongs in the register with that category, not omitted
because it was inconvenient. Anything postponed silently is the failure mode
this system exists to prevent.

## 5. Document formats

### Decision (ADR) — `decisions/NNNN-short-name.md`

Numbered sequentially, never renumbered. Referenced from code **by number**
("ADR 0019"), never by path, so files can move.

```markdown
# NNNN — Title

**Status:** Proposed | Accepted | Superseded by NNNN
**Date:** YYYY-MM-DD

## Context
What forced a choice. The constraint, not the history.

## Options
What was actually considered, and the cost of each.

## Decision
What was chosen.

## Consequences
What this makes easy, what it makes hard, what it forecloses.
```

A superseded ADR is **not edited to look correct**. It keeps its text and gains
a status line pointing forward. The wrong answer and why we believed it is the
useful part.

### Architecture — `architecture/<subject>.md`

Describes the system **as it is**, present tense. If it describes something
aspirational, it is wrong and is a defect in the document.

State the invariant, where it is enforced (file path), and what breaks if it is
violated. Aim at a competent engineer who has not seen the code.

### Phase — `phases/<product>.md`

One file per product, one row per phase: what it was meant to deliver, what
exists, status, and what is attached to it. Phase *descriptions* live in
`phases/roadmap.md` and are not duplicated.

A phase is **Verified** only under §6. `Implemented` and `Verified` are
different words for different states.

### Rules — `rules.md`

Constraints that fail work outright. Short, imperative, each with its reason.

## 6. What "verified" requires

A thing is Verified only with all three:

1. **A named test** that fails if the work regresses, or a recorded manual
   procedure and its result.
2. **The verification command actually run**, with its outcome recorded.
3. **The commit** that carries it.

Source existing is not proof. A ticked checkbox is not proof. A summary
asserting success is not proof.

**A test must fail when the thing it names is broken.** Never the reverse. If a
property cannot be satisfied yet, the honest forms are: a shrinking whitelist
pinning the exact known violations, or a skipped test naming the reason. Never
an assertion written to pass *because* the violation is present.

> Both rules are written from experience. Four architecture tests were once
> written as `expect(offenders.length).toBeGreaterThan(0)` — green because the
> violation was there, guaranteed to fail once fixed. Separately, a build in
> which no agent submission could succeed passed several review rounds because
> the suite was never run.

## 7. Relationship to Git and the code

**Git records what changed. Documentation records what the work was and why.**
Never paste diffs or narrate edits into a document — record the commit hash and
let `git show` answer.

- Commit subjects name their issue: `fix(harness): ... (#12)`.
- An issue reaching **Solved** records its commit.
- Documentation and code are checked against each other. Neither is
  automatically right; a disagreement is itself a finding. A document
  describing behaviour the code does not have is a defect in the document.

## 8. Why the obvious folders are not here

Deliberate omissions, so nobody re-adds them by reflex:

| Not a folder | Because |
|---|---|
| `audits/` | An audit is temporary work. It runs inside `work/`; its findings become numbered issues, and its durable residue lands in `phases/` and `decisions/`. |
| `blockers/` | "Blocked" is an issue category (**Needs Decision**), not a place. A blocker in its own folder is a blocker nobody reads. |
| `follow-ups/` | Same. Deferring work is a *category* with a reason, kept beside everything else. |
| `tasks/` | Temporary by definition. Lives in `work/`, archived on close. |
| `tree/` | A derived view, not a source. It is a section of `project-map.md`. |
| per-product doc folders | One documentation root. Products are distinguished inside files, not by splitting the system. |

The test for adding a folder: **does something durable live here that has no
home?** If the answer is "it would be tidier", the answer is no.

## 9. Adding to it

| The fact is… | It goes in… |
|---|---|
| A choice with alternatives | `decisions/`, next ADR number |
| How the system is shaped | `architecture/` |
| What a phase delivered | `phases/` |
| A constraint that fails work | `rules.md` |
| Anything we are currently doing | the meta-task in `work/` |
| A defect, question, or postponement | the meta-task issue register, categorized |

If a fact fits none of these, the structure is wrong. Fix the structure — do
not add a sixth place to look.
